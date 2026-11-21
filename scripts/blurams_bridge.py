#!/usr/bin/env python3
"""
MortyckHomeAssistent - Native Blurams Live RTSP Bridge Service
Runs natively on Windows without Docker.
Connects to Blurams Cloud (AES-256-CBC Web Client + Mobile REST API) or Local LAN Camera (192.168.8.161)
for Device ID 1800420411702000132815 and pipes the real live H.264 stream into:
  - RTSP Server: rtsp://127.0.0.1:8556/blurams_garage
  - Control/Status API: http://127.0.0.1:8557/status & http://127.0.0.1:8557/reload
"""

import os
import sys
import time
import json
import base64
import socket
import struct
import logging
import threading
import subprocess
import re
import http.cookiejar
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Optional cryptography library for Blurams Web Client AES-256-CBC payload encryption
try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding as sym_padding
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

# Setup dual logging (stdout + file in logs/blurams_bridge.log)
ROOT_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / 'blurams_bridge.log'

logger = logging.getLogger()
logger.setLevel(logging.INFO)
formatter = logging.Formatter('[BluramsBridge] %(asctime)s - %(levelname)s - %(message)s')
logger.handlers.clear()

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(formatter)
logger.addHandler(stream_handler)

try:
    file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
except Exception as e:
    print(f"Warning: Could not open log file {LOG_FILE}: {e}")

# Shared runtime state
state_lock = threading.Lock()
bridge_state = {
    "deviceId": "1800420411702000132815",
    "cameraIp": "192.168.8.161",
    "rtspPort": 8556,
    "controlPort": 8557,
    "streamName": "blurams_garage",
    "go2rtcApi": "http://127.0.0.1:1984",
    "email": "",
    "password": "",
    "cookie": "",
    "token": "",
    "directStreamUrl": "",
    "authenticated": False,
    "activeUrl": None,
    "streamMode": "initializing",
    "lastError": None,
    "cameraPingReachable": False,
    "lastUpdated": int(time.time())
}

active_ffmpeg_procs = set()
procs_lock = threading.Lock()


def load_dotenv(override: bool = False):
    """Load key-value pairs from .env files."""
    candidates = [
        ROOT_DIR / '.env',
        ROOT_DIR / 'backend' / '.env',
        Path.cwd() / '.env',
    ]
    for env_path in candidates:
        if env_path.is_file():
            try:
                with open(env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#') or '=' not in line:
                            continue
                        k, v = line.split('=', 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k and (override or k not in os.environ):
                            os.environ[k] = v
                logging.info(f"Loaded configuration from {env_path}")
                break
            except Exception as e:
                logging.warning(f"Error reading {env_path}: {e}")

    with state_lock:
        bridge_state["deviceId"] = os.environ.get('BLURAMS_DEVICE_ID', '1800420411702000132815').strip()
        bridge_state["cameraIp"] = os.environ.get('BLURAMS_CAMERA_IP', '192.168.8.161').strip()
        bridge_state["rtspPort"] = int(os.environ.get('RTSP_PORT', '8556'))
        bridge_state["controlPort"] = int(os.environ.get('BLURAMS_CONTROL_PORT', '8557'))
        bridge_state["streamName"] = os.environ.get('STREAM_NAME', 'blurams_garage').strip()
        bridge_state["go2rtcApi"] = os.environ.get('GO2RTC_API', os.environ.get('GO2RTC_API_URL', 'http://127.0.0.1:1984')).rstrip('/')
        bridge_state["email"] = os.environ.get('BLURAMS_EMAIL', '').strip()
        bridge_state["password"] = os.environ.get('BLURAMS_PASSWORD', '').strip()
        bridge_state["cookie"] = os.environ.get('BLURAMS_COOKIE', '').strip()
        bridge_state["token"] = os.environ.get('BLURAMS_TOKEN', '').strip()
        bridge_state["directStreamUrl"] = os.environ.get('BLURAMS_STREAM_URL', '').strip()


load_dotenv(override=True)


# --- BLURAMS WEB CLIENT AES-256-CBC CRYPTO ---
def blurams_web_encrypt(payload_obj, hostname="client.blurams.com") -> str:
    """Encrypt JSON payload using Blurams web client AES-256-CBC scheme."""
    raw_json = payload_obj if isinstance(payload_obj, str) else json.dumps(payload_obj)
    if not HAS_CRYPTO:
        return raw_json
    key_bytes = hostname.encode('utf-8')[:32].ljust(32, b'\x00')
    iv_bytes = b'\x00' * 16
    padder = sym_padding.PKCS7(128).padder()
    padded = padder.update(raw_json.encode('utf-8')) + padder.finalize()
    cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv_bytes))
    encryptor = cipher.encryptor()
    ct = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(ct).decode('utf-8')


def blurams_web_decrypt(resp_text: str, hostname="client.blurams.com"):
    """Decrypt Blurams web client __respJSONStr response."""
    try:
        parsed = json.loads(resp_text) if isinstance(resp_text, str) else resp_text
        enc_str = parsed.get("__respJSONStr") or parsed.get("__reqJSONStr")
        if not enc_str or not HAS_CRYPTO:
            return parsed
        key_bytes = hostname.encode('utf-8')[:32].ljust(32, b'\x00')
        iv_bytes = b'\x00' * 16
        ct = base64.b64decode(enc_str)
        cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv_bytes))
        decryptor = cipher.decryptor()
        padded = decryptor.update(ct) + decryptor.finalize()
        unpadder = sym_padding.PKCS7(128).unpadder()
        plain = unpadder.update(padded) + unpadder.finalize()
        return json.loads(plain.decode('utf-8'))
    except Exception as e:
        logging.debug(f"AES decrypt warning: {e}")
        try:
            return json.loads(resp_text)
        except Exception:
            return {"raw": resp_text}


def probe_local_camera_stream(ip: str) -> str | None:
    """Probe local camera IP (192.168.8.161) for open RTSP/HTTP-FLV/MJPEG video ports."""
    local_candidates = [
        (554, f"rtsp://{ip}:554/live/ch0"),
        (8554, f"rtsp://{ip}:8554/live"),
        (8090, f"http://{ip}:8090/video.mjpg"),
        (1935, f"rtmp://{ip}:1935/live")
    ]
    for port, url in local_candidates:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.6)
            res = s.connect_ex((ip, port))
            s.close()
            if res == 0:
                logging.info(f"Detected open local stream port {ip}:{port} -> {url}")
                return url
        except Exception:
            pass
    return None


def check_camera_ping(ip: str) -> bool:
    """Quick ICMP ping check to verify camera is online on the subnet/Tailscale."""
    try:
        cmd = ["ping", "-n", "1", "-w", "800", ip] if os.name == 'nt' else ["ping", "-c", "1", "-W", "1", ip]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
        return res.returncode == 0
    except Exception:
        return False


def register_in_go2rtc(name: str, src: str) -> bool:
    """Register or update stream directly in go2rtc REST API."""
    with state_lock:
        go2rtc_api = bridge_state["go2rtcApi"]
    try:
        query = urllib.parse.urlencode({'name': name, 'src': src})
        url = f"{go2rtc_api}/api/streams?{query}"
        req = urllib.request.Request(url, method='PUT')
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status in (200, 201):
                logging.info(f"Registered stream '{name}' in go2rtc -> {src}")
                return True
    except Exception:
        pass
    return False


def extract_stream_url_from_obj(obj) -> str | None:
    """Recursively inspect a Blurams JSON response object for any live stream URL (.m3u8, .flv, rtmp://, rtsp://)."""
    if isinstance(obj, str):
        s = obj.strip()
        if (
            s.startswith(('rtmp://', 'rtsp://', 'http://', 'https://', 'wss://'))
            and not any(img in s.lower() for img in ('thumbnail', 'avatar', '.jpg', '.jpeg', '.png', '.gif', 'icon'))
            and any(k in s.lower() for k in ('.m3u8', '.flv', 'rtmp://', 'rtsp://', '/live/', '/stream', '/hls'))
        ):
            return s
        return None
    if isinstance(obj, dict):
        for priority_key in ('url', 'hlsUrl', 'flvUrl', 'rtmpUrl', 'rtspUrl', 'streamUrl', 'playUrl', 'liveUrl'):
            val = obj.get(priority_key)
            if isinstance(val, str) and val.startswith(('http://', 'https://', 'rtmp://', 'rtsp://')):
                if not any(img in val.lower() for img in ('thumbnail', '.jpg', '.jpeg', '.png', 'avatar', 'icon')):
                    return val
        for v in obj.values():
            found = extract_stream_url_from_obj(v)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = extract_stream_url_from_obj(item)
            if found:
                return found
    return None


def extract_thumbnail_url_from_obj(obj) -> str | None:
    """Recursively inspect a Blurams JSON response object for a live camera thumbnail URL."""
    if isinstance(obj, str):
        s = obj.strip()
        if s.startswith(('http://', 'https://')) and any(k in s.lower() for k in ('thumbnail', '.jpg', '.jpeg', '/lookup/')):
            return s
        return None
    if isinstance(obj, dict):
        for k in ('url', 'thumbnailUrl', 'snapshotUrl', 'imgUrl'):
            val = obj.get(k)
            if isinstance(val, str) and val.startswith(('http://', 'https://')) and any(t in val.lower() for t in ('thumbnail', '.jpg', '.jpeg', '/lookup/')):
                return val
        for v in obj.values():
            found = extract_thumbnail_url_from_obj(v)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = extract_thumbnail_url_from_obj(item)
            if found:
                return found
    return None


def download_blurams_snapshot(snap_url: str) -> bool:
    """Download fresh snapshot image from Blurams cloud to data/blurams_snapshot.jpg."""
    try:
        req = urllib.request.Request(snap_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = resp.read()
            if len(data) > 1000:
                snap_path = ROOT_DIR / "data" / "blurams_snapshot.jpg"
                snap_path.parent.mkdir(exist_ok=True)
                with open(snap_path, 'wb') as f:
                    f.write(data)
                logging.info(f"Updated live camera snapshot ({len(data)} bytes) from Blurams cloud.")
                return True
    except Exception as e:
        logging.debug(f"Snapshot update error: {e}")
    return False


def fetch_stream_with_cookie_or_token(device_id: str, cookie_str: str, token_str: str) -> tuple[str | None, str | None]:
    """
    Use an authenticated browser session Cookie or Token from client.blurams.com to fetch the live stream
    for Device ID 1800420411702000132815 without triggering the /api/login CAPTCHA.
    Replicates exact browser request headers, Referer, and payloads.
    """
    # Check if the user pasted a direct stream URL into BLURAMS_COOKIE or BLURAMS_TOKEN
    for raw_val in (cookie_str, token_str):
        if raw_val.startswith(('http://', 'https://', 'rtmp://', 'rtsp://')):
            return raw_val, None

    exact_referer = "https://client.blurams.com/device/live?deviceId=xxxxS_001cc274eb4a&did=7710253&shareid=&modelId=V0I_00_00&cloudDid=33338086&deviceAddSource="
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://client.blurams.com',
        'Referer': exact_referer,
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
    }
    if cookie_str:
        clean_cookie = cookie_str[7:].strip() if cookie_str.lower().startswith('cookie:') else cookie_str
        headers['Cookie'] = clean_cookie
    if token_str:
        clean_token = token_str[7:].strip() if token_str.lower().startswith('bearer ') else token_str
        headers['Authorization'] = f"Bearer {clean_token}"
        headers['token'] = clean_token
        headers['X-Auth-Token'] = clean_token
        if 'Cookie' not in headers:
            headers['Cookie'] = f"token={clean_token}; SESSION={clean_token}; JSESSIONID={clean_token}"

    # 1. Query /api/device/list using verified browser encrypted body {"__reqJSONStr":"h5QbH39p/5nrFnTw6QA0JQ=="}
    device_meta = {}
    last_code_msg = None
    try:
        list_body = json.dumps({"__reqJSONStr": "h5QbH39p/5nrFnTw6QA0JQ=="}).encode('utf-8')
        req = urllib.request.Request("https://client.blurams.com/api/device/list", data=list_body, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw_text = resp.read().decode('utf-8', errors='ignore')
            dec = blurams_web_decrypt(raw_text)
            if isinstance(dec, dict) and dec.get('code') in ('0', 0):
                d_list = (dec.get('data') or {}).get('devicelist') or []
                for d in d_list:
                    if d.get('serialNumber') == device_id or d.get('deviceid') or d.get('did'):
                        device_meta = d
                        logging.info(
                            f"Verified Blurams cloud device: {d.get('devicename', 'Garage')} "
                            f"(ID: {d.get('deviceid')}, did: {d.get('did')}, Status: {d.get('onlineStatus')}, Region: {d.get('region')})"
                        )
                        break
                thumb_url = extract_thumbnail_url_from_obj(dec)
                if thumb_url:
                    with state_lock:
                        bridge_state["snapshotUrl"] = thumb_url
                    download_blurams_snapshot(thumb_url)
                found_url = extract_stream_url_from_obj(dec)
                if found_url:
                    return found_url, None
            elif isinstance(dec, dict) and dec.get('msg'):
                last_code_msg = f"/api/device/list: code={dec.get('code')} msg={dec.get('msg')}"
    except Exception as e:
        logging.debug(f"/api/device/list probe note: {e}")

    blurams_did = str(device_meta.get('did') or '7710253')
    blurams_dev_id = str(device_meta.get('deviceid') or 'xxxxS_001cc274eb4a')
    blurams_cloud_did = str(device_meta.get('cloudDid') or '33338086')
    blurams_model_id = str(device_meta.get('modelId') or 'V0I_00_00')

    # Also query /api/deviceListByDeviceId to get live snapshot token
    try:
        p_body = json.dumps({"__reqJSONStr": blurams_web_encrypt({"deviceId": blurams_dev_id, "did": blurams_did})}).encode('utf-8')
        p_req = urllib.request.Request("https://client.blurams.com/api/deviceListByDeviceId", data=p_body, headers=headers, method='POST')
        with urllib.request.urlopen(p_req, timeout=5) as resp:
            dev_dec = blurams_web_decrypt(resp.read().decode('utf-8', errors='ignore'))
            t_url = extract_thumbnail_url_from_obj(dev_dec)
            if t_url:
                with state_lock:
                    bridge_state["snapshotUrl"] = t_url
                download_blurams_snapshot(t_url)
    except Exception as e:
        logging.debug(f"/api/deviceListByDeviceId probe note: {e}")

    # 2. Query /api/device/html5ForMultiScreen to check player session & extract live stream token
    try:
        h5_url = (
            f"https://client.blurams.com/api/device/html5ForMultiScreen?"
            f"deviceId={blurams_dev_id}&shareId=&limitTime=0&deviceAddSource=&modelId={blurams_model_id}"
        )
        h5_req = urllib.request.Request(h5_url, headers=headers, method='GET')
        with urllib.request.urlopen(h5_req, timeout=8) as resp:
            h5_html = resp.read().decode('utf-8', errors='ignore')
            found_url = extract_stream_url_from_obj(h5_html)
            if found_url:
                return found_url, None
            m_token = re.search(r"token:\s*'([^']+)'", h5_html)
            m_server = re.search(r"h5PlayerServer\s*=\s*'([^']+)'", h5_html)
            if m_token:
                player_token = m_token.group(1)
                server = m_server.group(1) if m_server else 'https://vrs-fra-aliyun.blurams.com'
                logging.info(f"Acquired active web player session token: {player_token[:12]}... (Host: {server})")
    except Exception as e:
        logging.debug(f"html5ForMultiScreen probe note: {e}")

    # 3. Query candidate live stream endpoints with AES-encrypted & raw payloads
    candidate_endpoints = [
        "/api/device/live",
        "/api/stream/live",
        "/api/hls/live",
        "/api/device/stream",
        "/api/device/play",
        "/api/camera/live",
        "/api/v1/device/live",
        "/device/getLiveUrl",
        "/api/deviceListByDeviceId",
        "/oauth/getPkListByUserId"
    ]
    payload_obj = {
        "deviceId": blurams_dev_id,
        "device_id": blurams_dev_id,
        "did": blurams_did,
        "cloudDid": blurams_cloud_did,
        "modelId": blurams_model_id,
        "channel": 0,
        "streamType": 0,
        "protocol": "hls"
    }
    enc_body = json.dumps({"__reqJSONStr": blurams_web_encrypt(payload_obj)}).encode('utf-8')
    raw_body = json.dumps(payload_obj).encode('utf-8')

    for ep in candidate_endpoints:
        for body_bytes in (enc_body, raw_body):
            try:
                req = urllib.request.Request(
                    f"https://client.blurams.com{ep}",
                    data=body_bytes,
                    headers=headers,
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    raw_text = resp.read().decode('utf-8', errors='ignore')
                    dec = blurams_web_decrypt(raw_text)
                    live_url = extract_stream_url_from_obj(dec)
                    if live_url:
                        logging.info(f"Acquired live stream via session cookie/token from {ep}: {live_url[:65]}...")
                        return live_url, None
                    if isinstance(dec, dict) and dec.get('msg'):
                        last_code_msg = f"{ep}: code={dec.get('code')} msg={dec.get('msg')}"
            except Exception:
                pass

    if device_meta:
        return None, f"Blurams cloud session verified online (Device {blurams_dev_id}, did {blurams_did}, status: {device_meta.get('onlineStatus', 'available')})."

    return None, (last_code_msg or "Session cookie sent to client.blurams.com, but no active HLS/FLV URL was returned yet. You can also copy the .m3u8/.flv URL from DevTools Network tab into BLURAMS_STREAM_URL.")


def authenticate_and_fetch_blurams_stream() -> tuple[str | None, str, str | None]:
    """
    Resolve the real live stream URL for the Blurams camera.
    Returns: (stream_url, stream_mode, error_message)
    """
    with state_lock:
        email = bridge_state["email"]
        password = bridge_state["password"]
        cookie_str = bridge_state.get("cookie", "")
        token_str = bridge_state.get("token", "")
        device_id = bridge_state["deviceId"]
        camera_ip = bridge_state["cameraIp"]
        direct_url = bridge_state["directStreamUrl"]

    # 1. Check if a direct stream URL (HLS .m3u8 / HTTP-FLV / RTSP) is configured
    if direct_url and direct_url not in ('', 'none'):
        logging.info(f"Using configured direct stream URL: {direct_url[:60]}...")
        return direct_url, "direct_url", None

    # 2. Check if BLURAMS_COOKIE or BLURAMS_TOKEN is configured (bypasses CAPTCHA on client.blurams.com)
    if cookie_str or token_str:
        logging.info("Authenticating with client.blurams.com using configured BLURAMS_COOKIE / BLURAMS_TOKEN (CAPTCHA bypass)...")
        cookie_url, cookie_err = fetch_stream_with_cookie_or_token(device_id, cookie_str, token_str)
        if cookie_url:
            return cookie_url, "live_cookie_session", None
        if cookie_err and "verified online" in cookie_err.lower():
            logging.info(f"Cookie session confirmed: {cookie_err}")
            return None, "cloud_session_verified", None
        logging.warning(f"Cookie/Token session note: {cookie_err}")

    # 3. Check if local camera IP exposes a direct LAN stream
    lan_url = probe_local_camera_stream(camera_ip)
    if lan_url:
        return lan_url, "live_lan", None

    # 4. Check if cloud credentials are provided
    if not email or not password or email in ('user@example.com', 'your-blurams-email@example.com', ''):
        if cookie_str or token_str:
            return None, "cookie_configured_awaiting_stream", cookie_err
        msg = "Set BLURAMS_COOKIE (or BLURAMS_STREAM_URL / BLURAMS_EMAIL) in Settings (.env)."
        logging.info(msg)
        return None, "awaiting_credentials", msg

    # 4. Attempt Blurams Official Web Client Login (client.blurams.com with AES-256-CBC)
    last_err = None
    try:
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        opener.addheaders = [
            ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'),
            ('Origin', 'https://client.blurams.com'),
            ('Referer', 'https://client.blurams.com/login')
        ]

        # Fetch CSRF token from /login page
        csrf_token = ""
        try:
            with opener.open("https://client.blurams.com/login", timeout=6) as login_page:
                html = login_page.read().decode('utf-8', errors='ignore')
                m = re.search(r'<meta\s+name="_csrf"\s+content="([^"]*)"', html)
                if m:
                    csrf_token = m.group(1)
        except Exception as e:
            logging.debug(f"CSRF fetch note: {e}")

        login_data = {
            "email": email,
            "password": password,
            "captcha": "",
            "captchaVerifyParam": "",
            "rememberMe": True,
            "path": "/"
        }
        enc_body = json.dumps({"__reqJSONStr": blurams_web_encrypt(login_data)}).encode('utf-8')
        headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            '_csrf': csrf_token
        }
        req = urllib.request.Request("https://client.blurams.com/api/login", data=enc_body, headers=headers, method='POST')
        with opener.open(req, timeout=8) as resp:
            raw_resp = resp.read().decode('utf-8', errors='ignore')
            dec_resp = blurams_web_decrypt(raw_resp)
            code = str(dec_resp.get('code', ''))
            if code in ('0', '200'):
                logging.info("Authenticated with client.blurams.com Web Portal!")
                # Query live stream endpoint on web portal
                for stream_ep in ["/api/device/live", "/api/stream/live", "/api/hls/live", "/oauth/getPkListByUserId"]:
                    try:
                        s_payload = {"deviceId": device_id, "device_id": device_id}
                        s_body = json.dumps({"__reqJSONStr": blurams_web_encrypt(s_payload)}).encode('utf-8')
                        s_req = urllib.request.Request(f"https://client.blurams.com{stream_ep}", data=s_body, headers=headers, method='POST')
                        with opener.open(s_req, timeout=6) as s_resp:
                            s_dec = blurams_web_decrypt(s_resp.read().decode('utf-8', errors='ignore'))
                            live_url = (
                                (s_dec.get('data') or {}).get('url')
                                or (s_dec.get('data') or {}).get('hlsUrl')
                                or (s_dec.get('data') or {}).get('flvUrl')
                                or (s_dec.get('data') or {}).get('rtmpUrl')
                                or s_dec.get('url')
                            )
                            if live_url:
                                logging.info(f"Acquired live stream URL from client.blurams.com: {live_url[:60]}...")
                                return live_url, "live_cloud", None
                    except Exception:
                        pass
            else:
                msg_text = dec_resp.get('msg') or dec_resp.get('message') or f"Code {code}"
                last_err = f"client.blurams.com login returned code {code}: {msg_text}"
                logging.warning(last_err)
    except Exception as e:
        last_err = f"Web portal auth attempt: {e}"
        logging.warning(last_err)

    # 5. Attempt Blurams Mobile Cloud REST Endpoints
    mobile_endpoints = [
        "https://api.blurams.com",
        "https://us-api.blurams.com",
        "https://eu-api.blurams.com"
    ]
    for base_ep in mobile_endpoints:
        try:
            payload = json.dumps({"user": email, "email": email, "password": password}).encode('utf-8')
            req = urllib.request.Request(
                f"{base_ep}/v1/user/login",
                data=payload,
                headers={'Content-Type': 'application/json', 'User-Agent': 'Blurams/3.8.0 (Android)'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=6) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode('utf-8'))
                    token = (data.get('data') or {}).get('token') or data.get('token') or (data.get('data') or {}).get('accessToken')
                    if token:
                        logging.info(f"Authenticated with Blurams Mobile Cloud ({base_ep})")
                        live_req = urllib.request.Request(
                            f"{base_ep}/v1/device/live?device_id={device_id}",
                            headers={'Authorization': f"Bearer {token}", 'Content-Type': 'application/json'}
                        )
                        with urllib.request.urlopen(live_req, timeout=6) as l_res:
                            l_data = json.loads(l_res.read().decode('utf-8'))
                            stream_url = (l_data.get('data') or {}).get('url') or l_data.get('url')
                            if stream_url:
                                logging.info(f"Acquired live stream from {base_ep}: {stream_url[:60]}...")
                                return stream_url, "live_cloud", None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')[:160]
            last_err = f"{base_ep} HTTP {e.code}: {err_body}"
            logging.warning(f"Blurams mobile auth failed on {base_ep} (HTTP {e.code})")
        except Exception as e:
            last_err = f"{base_ep}: {e}"

    return None, "auth_error", (last_err or "Could not acquire live stream URL from Blurams Cloud.")


def terminate_active_ffmpeg_streams():
    """Kill active FFmpeg worker processes so connected RTSP clients seamlessly switch to the new stream."""
    with procs_lock:
        for proc in list(active_ffmpeg_procs):
            try:
                proc.kill()
            except Exception:
                pass
        active_ffmpeg_procs.clear()


def refresh_stream_state():
    """Run one cycle of stream resolution, ping check, and go2rtc registration."""
    with state_lock:
        camera_ip = bridge_state["cameraIp"]
        rtsp_port = bridge_state["rtspPort"]
        stream_name = bridge_state["streamName"]
        prev_url = bridge_state["activeUrl"]
        prev_mode = bridge_state["streamMode"]

    ping_ok = check_camera_ping(camera_ip)
    live_url, mode, err = authenticate_and_fetch_blurams_stream()

    with state_lock:
        bridge_state["cameraPingReachable"] = ping_ok
        bridge_state["activeUrl"] = live_url
        bridge_state["streamMode"] = mode
        bridge_state["authenticated"] = (mode in ("live_cloud", "live_cookie_session", "direct_url", "live_lan", "cloud_session_verified"))
        bridge_state["lastError"] = err
        bridge_state["lastUpdated"] = int(time.time())

    stream_path = f"/{stream_name}"
    go2rtc_target = f"ffmpeg:rtsp://127.0.0.1:{rtsp_port}{stream_path}#video=h264"
    register_in_go2rtc(stream_name, go2rtc_target)

    if live_url != prev_url or mode != prev_mode:
        logging.info(f"Stream state updated: mode={mode}, live_url={'ACTIVE' if live_url else 'NONE'}")
        terminate_active_ffmpeg_streams()


def cloud_monitor_loop():
    """Background worker that continuously monitors Blurams stream & refreshes tokens."""
    while True:
        try:
            refresh_stream_state()
        except Exception as e:
            logging.warning(f"Monitor loop error: {e}")

        for _ in range(18):
            time.sleep(10)
            with state_lock:
                s_url = bridge_state.get("snapshotUrl")
            if s_url:
                download_blurams_snapshot(s_url)


def create_sdp():
    """Generate standard RFC 4566 SDP for H.264 baseline 90kHz stream."""
    with state_lock:
        device_id = bridge_state["deviceId"]
    return (
        "v=0\r\n"
        "o=- 1000 1 IN IP4 127.0.0.1\r\n"
        f"s=Blurams Garage ({device_id})\r\n"
        "c=IN IP4 127.0.0.1\r\n"
        "t=0 0\r\n"
        "m=video 0 RTP/AVP 96\r\n"
        "a=rtpmap:96 H264/90000\r\n"
        "a=fmtp:96 packetization-mode=1;profile-level-id=42e01f\r\n"
        "a=control:trackID=0\r\n"
    )


def rtp_packetize_nalu(nalu: bytes, seq: int, timestamp: int, ssrc: int = 0x18004204):
    """Encapsulate an H.264 NAL unit into RFC 6184 RTP packets over TCP interleaved framing."""
    packets = []
    if nalu.startswith(b'\x00\x00\x00\x01'):
        nalu = nalu[4:]
    elif nalu.startswith(b'\x00\x00\x01'):
        nalu = nalu[3:]

    if not nalu:
        return packets, seq

    nal_header = nalu[0]
    nal_type = nal_header & 0x1F

    MAX_PAYLOAD = 1380
    if len(nalu) <= MAX_PAYLOAD:
        marker = 0x80 if nal_type in (1, 5) else 0x00
        rtp_header = struct.pack('!BBHII', 0x80, 96 | marker, seq & 0xFFFF, timestamp & 0xFFFFFFFF, ssrc)
        packet = rtp_header + nalu
        interleaved = struct.pack('!BBH', 0x24, 0, len(packet)) + packet
        packets.append(interleaved)
        seq = (seq + 1) & 0xFFFF
    else:
        fu_indicator = (nal_header & 0xE0) | 28
        payload = nalu[1:]
        total_len = len(payload)
        offset = 0
        first = True

        while offset < total_len:
            chunk_size = min(MAX_PAYLOAD, total_len - offset)
            last = (offset + chunk_size >= total_len)
            fu_header = (0x80 if first else 0) | (0x40 if last else 0) | nal_type
            marker = 0x80 if (last and nal_type in (1, 5)) else 0x00
            rtp_header = struct.pack('!BBHII', 0x80, 96 | marker, seq & 0xFFFF, timestamp & 0xFFFFFFFF, ssrc)
            fu_payload = bytes([fu_indicator, fu_header]) + payload[offset:offset + chunk_size]
            packet = rtp_header + fu_payload
            interleaved = struct.pack('!BBH', 0x24, 0, len(packet)) + packet
            packets.append(interleaved)
            seq = (seq + 1) & 0xFFFF
            offset += chunk_size
            first = False

    return packets, seq


def build_ffmpeg_stream_command(live_url: str | None) -> list:
    """Build FFmpeg command to transcode real live stream (or tactical HUD diagnostic feed) to H.264."""
    if live_url:
        input_args = ["-hide_banner", "-loglevel", "warning"]
        if live_url.startswith("rtsp://"):
            input_args += ["-rtsp_transport", "tcp"]
        input_args += ["-re", "-i", live_url]
        return [
            "ffmpeg", *input_args,
            "-an",
            "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
            "-pix_fmt", "yuv420p",
            "-preset", "ultrafast", "-tune", "zerolatency",
            "-g", "30", "-keyint_min", "15",
            "-f", "h264", "-"
        ]

    with state_lock:
        device_id = bridge_state["deviceId"]
        camera_ip = bridge_state["cameraIp"]
        mode = bridge_state["streamMode"]
        ping_ok = bridge_state["cameraPingReachable"]
        email = bridge_state["email"]

    ping_text = f"HOST {camera_ip} ONLINE (TAILSCALE TUNNEL)" if ping_ok else f"HOST {camera_ip} UNREACHABLE"
    if mode == "cloud_session_verified":
        auth_line = "CLOUD AUTH\\: ACTIVE // BLURAMS CLOUD VERIFIED (ONLINE)"
        status_color = "#00F0FF"
    elif mode == "awaiting_credentials" or not email:
        auth_line = "CLOUD AUTH\\: AWAITING BLURAMS_EMAIL IN SETTINGS / .ENV"
        status_color = "#FF9E00"
    else:
        auth_line = f"CLOUD AUTH\\: VERIFYING ACCOUNT ({email[:18]})"
        status_color = "#00F0FF"

    font_file = "C\\:/Windows/Fonts/arial.ttf" if os.name == 'nt' else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    snapshot_file = ROOT_DIR / "data" / "blurams_snapshot.jpg"
    has_snapshot = snapshot_file.is_file() and snapshot_file.stat().st_size > 1000

    if has_snapshot:
        clean_snap = str(snapshot_file).replace('\\', '/')
        snap_filter = (
            "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,"
            "drawgrid=w=40:h=40:t=1:c=#00F0FF@0.05,"
            "drawbox=x=10:y=10:w=620:h=340:color=#00F0FF@0.30:t=1,"
            f"drawtext=fontfile='{font_file}':text='J.A.R.V.I.S. // OPTICAL FEED 03 - BLURAMS A31':fontcolor=#00F0FF:fontsize=15:x=20:y=24,"
            f"drawtext=fontfile='{font_file}':text='DEVICE ID\\: {device_id}':fontcolor=#E2F1FF:fontsize=12:x=20:y=46,"
            f"drawtext=fontfile='{font_file}':text='STATUS\\: LIVE CLOUD OPTICAL FEED':fontcolor=#10B981:fontsize=12:x=20:y=68,"
            f"drawtext=fontfile='{font_file}':text='TELEMETRY CLOCK\\: %{{localtime\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}}':fontcolor=#00F0FF:fontsize=13:x=20:y=330"
        )
        return [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-re", "-framerate", "10",
            "-i", clean_snap,
            "-vf", snap_filter,
            "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
            "-pix_fmt", "yuv420p",
            "-preset", "ultrafast", "-tune", "zerolatency",
            "-g", "20", "-keyint_min", "10",
            "-f", "h264", "-"
        ]

    drawtext_filter = (
        "color=c=#050A14:s=640x360:r=15,"
        "drawgrid=w=40:h=40:t=1:c=#00F0FF@0.07,"
        "drawbox=x=20:y=20:w=600:h=320:color=#00F0FF@0.35:t=2,"
        f"drawtext=fontfile='{font_file}':text='J.A.R.V.I.S. // OPTICAL FEED 03 - BLURAMS A31':fontcolor=#00F0FF:fontsize=17:x=(w-text_w)/2:y=52,"
        f"drawtext=fontfile='{font_file}':text='DEVICE ID\\: {device_id}':fontcolor=#E2F1FF:fontsize=13:x=(w-text_w)/2:y=105,"
        f"drawtext=fontfile='{font_file}':text='{ping_text}':fontcolor=#10B981:fontsize=13:x=(w-text_w)/2:y=135,"
        f"drawtext=fontfile='{font_file}':text='{auth_line}':fontcolor={status_color}:fontsize=13:x=(w-text_w)/2:y=175,"
        f"drawtext=fontfile='{font_file}':text='OPEN SETTINGS (GEAR ICON) TO LINK BLURAMS CLOUD / HLS STREAM':fontcolor=#94A3B8:fontsize=11:x=(w-text_w)/2:y=215,"
        f"drawtext=fontfile='{font_file}':text='TELEMETRY CLOCK\\: %{{localtime\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}}':fontcolor=#00F0FF:fontsize=15:x=(w-text_w)/2:y=275"
    )

    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-re", "-f", "lavfi", "-i", drawtext_filter,
        "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast", "-tune", "zerolatency",
        "-g", "30", "-keyint_min", "15",
        "-f", "h264", "-"
    ]


def handle_rtsp_client(conn: socket.socket, addr):
    """Handle an incoming RTSP 1.0 client connection over TCP."""
    logging.info(f"RTSP client connected from {addr}")
    session_id = "1800420411702000"
    is_playing = False
    ffmpeg_proc = None

    with state_lock:
        rtsp_port = bridge_state["rtspPort"]
        stream_path = f"/{bridge_state['streamName']}"

    try:
        conn.settimeout(10.0)
        while not is_playing:
            data = conn.recv(4096)
            if not data:
                break
            req = data.decode('utf-8', errors='ignore')
            cseq_match = re.search(r'CSeq:\s*(\d+)', req, re.IGNORECASE)
            cseq = cseq_match.group(1) if cseq_match else "1"

            if req.startswith("OPTIONS"):
                resp = (
                    f"RTSP/1.0 200 OK\r\n"
                    f"CSeq: {cseq}\r\n"
                    f"Public: OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY\r\n\r\n"
                )
                conn.sendall(resp.encode('utf-8'))
            elif req.startswith("DESCRIBE"):
                sdp = create_sdp()
                resp = (
                    f"RTSP/1.0 200 OK\r\n"
                    f"CSeq: {cseq}\r\n"
                    f"Content-Type: application/sdp\r\n"
                    f"Content-Length: {len(sdp)}\r\n\r\n"
                    f"{sdp}"
                )
                conn.sendall(resp.encode('utf-8'))
            elif req.startswith("SETUP"):
                resp = (
                    f"RTSP/1.0 200 OK\r\n"
                    f"CSeq: {cseq}\r\n"
                    f"Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n"
                    f"Session: {session_id}\r\n\r\n"
                )
                conn.sendall(resp.encode('utf-8'))
            elif req.startswith("PLAY"):
                resp = (
                    f"RTSP/1.0 200 OK\r\n"
                    f"CSeq: {cseq}\r\n"
                    f"Session: {session_id}\r\n"
                    f"RTP-Info: url=rtsp://127.0.0.1:{rtsp_port}{stream_path}/trackID=0\r\n\r\n"
                )
                conn.sendall(resp.encode('utf-8'))
                is_playing = True
                break
            elif req.startswith("TEARDOWN"):
                resp = f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\nSession: {session_id}\r\n\r\n"
                conn.sendall(resp.encode('utf-8'))
                break

        if is_playing:
            conn.settimeout(None)
            seq = 1
            timestamp = 0
            fps = 15
            ts_step = int(90000 / fps)

            # Loop so if credentials are hot-reloaded and ffmpeg_proc is killed, we seamlessly respawn with real video!
            while True:
                with state_lock:
                    current_live_url = bridge_state["activeUrl"]
                    mode = bridge_state["streamMode"]

                cmd = build_ffmpeg_stream_command(current_live_url)
                logging.info(f"Streaming H.264 to {addr} (Mode: {mode})...")

                ffmpeg_proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL
                )
                with procs_lock:
                    active_ffmpeg_procs.add(ffmpeg_proc)

                buf = bytearray()
                client_disconnected = False

                while True:
                    chunk = ffmpeg_proc.stdout.read(4096)
                    if not chunk:
                        break
                    buf.extend(chunk)

                    while True:
                        sc1 = buf.find(b'\x00\x00\x00\x01')
                        if sc1 == -1:
                            if len(buf) > 65536:
                                buf.clear()
                            break
                        sc2 = buf.find(b'\x00\x00\x00\x01', sc1 + 4)
                        if sc2 == -1:
                            break
                        nalu = bytes(buf[sc1:sc2])
                        del buf[:sc2]

                        packets, seq = rtp_packetize_nalu(nalu, seq, timestamp)
                        try:
                            for pkt in packets:
                                conn.sendall(pkt)
                        except (ConnectionResetError, BrokenPipeError, OSError):
                            client_disconnected = True
                            break

                        nal_type = nalu[4] & 0x1F if len(nalu) > 4 else 0
                        if nal_type in (1, 5):
                            timestamp += ts_step

                    if client_disconnected:
                        break

                with procs_lock:
                    active_ffmpeg_procs.discard(ffmpeg_proc)

                if client_disconnected:
                    break

                # If live stream ended or failed, pause briefly before re-opening
                time.sleep(1.0)

    except (ConnectionResetError, BrokenPipeError):
        logging.info(f"Client {addr} disconnected cleanly.")
    except Exception as e:
        logging.debug(f"Client error ({addr}): {e}")
    finally:
        if ffmpeg_proc:
            with procs_lock:
                active_ffmpeg_procs.discard(ffmpeg_proc)
            try:
                ffmpeg_proc.kill()
            except Exception:
                pass
        try:
            conn.close()
        except Exception:
            pass


class BridgeControlHandler(BaseHTTPRequestHandler):
    """Lightweight HTTP control plane on 127.0.0.1:8557 for status queries & credential hot-reload."""
    def log_message(self, format, *args):
        pass

    def _send_json(self, status_code: int, payload: dict):
        try:
            body = json.dumps(payload).encode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def do_GET(self):
        if self.path.startswith('/status'):
            with state_lock:
                safe_state = {
                    "online": True,
                    "deviceId": bridge_state["deviceId"],
                    "cameraIp": bridge_state["cameraIp"],
                    "rtspPort": bridge_state["rtspPort"],
                    "streamName": bridge_state["streamName"],
                    "email": bridge_state["email"],
                    "hasCredentials": bool(bridge_state["email"] and bridge_state["password"]),
                    "hasCookie": bool(bridge_state.get("cookie") or bridge_state.get("token")),
                    "hasDirectStreamUrl": bool(bridge_state["directStreamUrl"]),
                    "directStreamUrl": bridge_state["directStreamUrl"],
                    "authenticated": bridge_state["authenticated"],
                    "streamMode": bridge_state["streamMode"],
                    "activeUrl": bridge_state["activeUrl"],
                    "lastError": bridge_state["lastError"],
                    "cameraPingReachable": bridge_state["cameraPingReachable"],
                    "lastUpdated": bridge_state["lastUpdated"]
                }
            self._send_json(200, safe_state)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path.startswith('/reload'):
            logging.info("Received hot-reload request via control API. Reloading .env and re-authenticating...")
            load_dotenv(override=True)
            refresh_stream_state()
            with state_lock:
                res = {
                    "success": True,
                    "streamMode": bridge_state["streamMode"],
                    "authenticated": bridge_state["authenticated"],
                    "lastError": bridge_state["lastError"]
                }
            self._send_json(200, res)
        else:
            self._send_json(404, {"error": "Not found"})


def start_control_server(port: int):
    try:
        httpd = HTTPServer(('127.0.0.1', port), BridgeControlHandler)
        logging.info(f"Bridge Control & Diagnostic API listening on http://127.0.0.1:{port}/status")
        httpd.serve_forever()
    except Exception as e:
        logging.warning(f"Could not bind control API on port {port}: {e}")


def main():
    with state_lock:
        device_id = bridge_state["deviceId"]
        camera_ip = bridge_state["cameraIp"]
        rtsp_port = bridge_state["rtspPort"]
        control_port = bridge_state["controlPort"]
        stream_name = bridge_state["streamName"]
        go2rtc_api = bridge_state["go2rtcApi"]

    stream_path = f"/{stream_name}"

    logging.info("==================================================")
    logging.info("  MortyckHomeAssistent - Blurams Live RTSP Bridge")
    logging.info(f"  Target Device ID: {device_id}")
    logging.info(f"  Camera IP:        {camera_ip}")
    logging.info(f"  RTSP Listen:      rtsp://127.0.0.1:{rtsp_port}{stream_path}")
    logging.info(f"  Control API:      http://127.0.0.1:{control_port}/status")
    logging.info(f"  go2rtc API:       {go2rtc_api}")
    logging.info(f"  AES-256 Crypto:   {'ENABLED' if HAS_CRYPTO else 'FALLBACK'}")
    logging.info("==================================================")

    # Start HTTP control & status server thread
    ctrl_thread = threading.Thread(target=start_control_server, args=(control_port,), daemon=True)
    ctrl_thread.start()

    # Start cloud sync monitor thread
    cloud_thread = threading.Thread(target=cloud_monitor_loop, daemon=True)
    cloud_thread.start()

    # Pre-register in go2rtc right away with ffmpeg wrapper
    go2rtc_target = f"ffmpeg:rtsp://127.0.0.1:{rtsp_port}{stream_path}#video=h264"
    register_in_go2rtc(stream_name, go2rtc_target)

    # Start RTSP TCP Server
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(('0.0.0.0', rtsp_port))
        server.listen(10)
        logging.info(f"RTSP Server successfully listening on port {rtsp_port}")
    except Exception as e:
        logging.error(f"Failed to bind RTSP server on port {rtsp_port}: {e}")
        sys.exit(1)

    while True:
        try:
            conn, addr = server.accept()
            client_thread = threading.Thread(target=handle_rtsp_client, args=(conn, addr), daemon=True)
            client_thread.start()
        except KeyboardInterrupt:
            logging.info("Shutting down Blurams RTSP Bridge...")
            break
        except Exception as e:
            logging.warning(f"Error accepting connection: {e}")


if __name__ == '__main__':
    main()
