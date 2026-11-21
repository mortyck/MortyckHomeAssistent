import os
import sys
import time
import json
import logging
import subprocess
import urllib.parse
import urllib.request

logging.basicConfig(level=logging.INFO, format='[BluramsBridge] %(asctime)s - %(levelname)s - %(message)s')

EMAIL = os.environ.get('BLURAMS_EMAIL', '')
PASSWORD = os.environ.get('BLURAMS_PASSWORD', '')
DEVICE_ID = os.environ.get('BLURAMS_DEVICE_ID', '1800420411702000132815')
CAMERA_IP = os.environ.get('BLURAMS_CAMERA_IP', '192.168.8.161')
RTSP_PORT = int(os.environ.get('RTSP_PORT', '8556'))
STREAM_NAME = os.environ.get('STREAM_NAME', 'blurams_garage')
GO2RTC_API = os.environ.get('GO2RTC_API', 'http://127.0.0.1:1984').rstrip('/')

def register_in_go2rtc(name, src):
    try:
        query = urllib.parse.urlencode({'name': name, 'src': src})
        url = f"{GO2RTC_API}/api/streams?{query}"
        req = urllib.request.Request(url, method='PUT')
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status in (200, 201):
                logging.info(f"Successfully registered stream '{name}' in go2rtc -> {src}")
                return True
    except Exception as e:
        logging.warning(f"Could not register in go2rtc ({e}). Will retry...")
    return False

def authenticate_blurams():
    if not EMAIL or not PASSWORD or EMAIL == 'user@example.com':
        logging.info("Blurams credentials not configured yet or placeholder. Standing by with local RTSP loopback.")
        return None

    api_endpoints = [
        "https://api.blurams.com/v1/user/login",
        "https://us-api.blurams.com/v1/user/login"
    ]

    for endpoint in api_endpoints:
        try:
            payload = json.dumps({"user": EMAIL, "password": PASSWORD}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=8) as res:
                if res.status == 200:
                    data = json.loads(res.read().decode('utf-8'))
                    token = data.get('data', {}).get('token') or data.get('token')
                    if token:
                        logging.info(f"Authenticated with Blurams Cloud API ({endpoint})")
                        return token
        except Exception as e:
            logging.warning(f"Blurams auth attempt failed on {endpoint}: {e}")
    return None

def get_live_stream_url(token, device_id):
    if not token:
        return None
    try:
        url = f"https://api.blurams.com/v1/device/live?device_id={device_id}"
        req = urllib.request.Request(url, headers={'Authorization': f"Bearer {token}", 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=8) as res:
            if res.status == 200:
                data = json.loads(res.read().decode('utf-8'))
                stream_url = data.get('data', {}).get('url') or data.get('url')
                return stream_url
    except Exception as e:
        logging.warning(f"Failed to fetch live stream URL for device {device_id}: {e}")
    return None

def main():
    logging.info("==================================================")
    logging.info(f"  Blurams RTSP Bridge Container Service")
    logging.info(f"  Target Device ID: {DEVICE_ID}")
    logging.info(f"  Camera IP:        {CAMERA_IP}")
    logging.info(f"  Stream Name:      {STREAM_NAME}")
    logging.info(f"  RTSP Port:        {RTSP_PORT}")
    logging.info(f"  go2rtc API:       {GO2RTC_API}")
    logging.info("==================================================")

    # Initial registration in go2rtc so the stream identifier is active
    local_rtsp_target = f"rtsp://127.0.0.1:{RTSP_PORT}/{STREAM_NAME}"
    register_in_go2rtc(STREAM_NAME, local_rtsp_target)

    while True:
        token = authenticate_blurams()
        live_url = get_live_stream_url(token, DEVICE_ID) if token else None

        if live_url:
            logging.info(f"Acquired live stream URL for Blurams {DEVICE_ID}. Dynamically registering with go2rtc.")
            register_in_go2rtc(STREAM_NAME, live_url)
        else:
            register_in_go2rtc(STREAM_NAME, local_rtsp_target)

        # Monitor and refresh session every 5 minutes
        for _ in range(30):
            time.sleep(10)

if __name__ == '__main__':
    main()
