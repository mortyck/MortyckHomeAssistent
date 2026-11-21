import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ShieldAlert,
  Download,
  RotateCw,
  VideoOff,
  Radio,
  Trash2,
  Edit3,
  Key
} from 'lucide-react';
import { Device, PTZCommand } from '../types';
import { sendPtzCommand, triggerCameraMotion, deleteDevice } from '../services/api';

interface WebRtcPlayerProps {
  device: Device;
  onEdit?: (device: Device) => void;
  onDelete?: (id: string) => void;
  onOpenSettings?: () => void;
}

export const WebRtcPlayer: React.FC<WebRtcPlayerProps> = ({
  device,
  onEdit,
  onDelete,
  onOpenSettings
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPtz, setShowPtz] = useState(false);
  const [streamHealth, setStreamHealth] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const streamName = (device.camera?.streamName || device.id)
    .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const isMotion = Boolean(device.state.motion_detected);
  const isBlurams = device.brand === 'Blurams' || streamName.includes('blurams');

  // Initialize real WebRTC connection via go2rtc WHEP / SDP endpoint
  useEffect(() => {
    let peerConnection: RTCPeerConnection | null = null;
    let isCancelled = false;

    async function initWebRtc() {
      try {
        setStreamHealth('connecting');
        setErrorMessage('');
        console.log(`[WebRtcPlayer] Initializing WebRTC for normalized stream: '${streamName}' (${device.name})`);

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peerConnection = pc;

        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setStreamHealth('online');
          }
        };

        pc.onconnectionstatechange = () => {
          if (!isCancelled) {
            if (pc.connectionState === 'connected') {
              setStreamHealth('online');
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              setStreamHealth('offline');
              setErrorMessage('WebRTC connection interrupted');
            }
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const queryParams = new URLSearchParams({ src: streamName }).toString();

        let answerSdp = '';
        try {
          const res = await fetch(`/go2rtc/api/webrtc?${queryParams}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
          });
          if (res.ok) {
            answerSdp = await res.text();
          }
        } catch {
          // Fallback to backend stream proxy
        }

        if (!answerSdp) {
          const backendRes = await fetch(`/api/streams/${encodeURIComponent(streamName)}/webrtc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
          });
          if (backendRes.ok) {
            answerSdp = await backendRes.text();
          } else {
            const auth = (device.camera?.username && device.camera?.password)
              ? `${device.camera.username}:${device.camera.password}@`
              : (device.camera?.username ? `${device.camera.username}@` : '');
            const defaultPath = device.brand === 'CamHi' ? '/11' : '/live/ch0';
            const path = device.camera?.rtspPath || defaultPath;
            const rtspUrl = device.camera?.rtspUrl || (
              device.ip ? `rtsp://${auth}${device.ip}:${device.port || 554}${path.startsWith('/') ? path : '/' + path}` : undefined
            );

            if (rtspUrl) {
              try {
                await fetch('/api/streams/register', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ streamName, rtspUrl })
                });

                const retryRes = await fetch(`/api/streams/${encodeURIComponent(streamName)}/webrtc`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/sdp' },
                  body: offer.sdp
                });
                if (retryRes.ok) {
                  answerSdp = await retryRes.text();
                }
              } catch {}
            }

            if (!answerSdp) {
              const errText = await backendRes.text();
              throw new Error(errText || 'Camera stream not ready in go2rtc');
            }
          }
        }

        if (answerSdp && !isCancelled) {
          await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }
      } catch (err: any) {
        if (!isCancelled) {
          setStreamHealth('offline');
          setErrorMessage(err.message || 'Waiting for live RTSP stream');
        }
      }
    }

    initWebRtc();

    return () => {
      isCancelled = true;
      if (peerConnection) {
        peerConnection.close();
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [device.id, streamName, retryNonce]);

  const handlePtz = useCallback(async (action: PTZCommand['action']) => {
    await sendPtzCommand(device.id, { action, speed: 0.5 });
  }, [device.id]);

  const handleSnapshot = async () => {
    setIsCapturing(true);
    let downloaded = false;

    if (streamHealth === 'online' && videoRef.current && videoRef.current.readyState >= 2) {
      try {
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = videoRef.current.videoWidth || 1280;
        snapCanvas.height = videoRef.current.videoHeight || 720;
        const snapCtx = snapCanvas.getContext('2d');
        if (snapCtx) {
          snapCtx.drawImage(videoRef.current, 0, 0);
          const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.95);
          const link = document.createElement('a');
          link.download = `snapshot_${device.name.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
          link.href = dataUrl;
          link.click();
          downloaded = true;
        }
      } catch {}
    }

    if (!downloaded) {
      try {
        const link = document.createElement('a');
        link.download = `snapshot_${device.name.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
        link.href = `/api/streams/${encodeURIComponent(streamName)}/frame.jpeg`;
        link.click();
      } catch {}
    }

    setTimeout(() => setIsCapturing(false), 600);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`dash-card overflow-hidden flex flex-col transition-all ${
        isMotion ? 'border-[#EF4444]' : ''
      }`}
    >
      {/* Top M.A.R.V.I.N. Tactical Header Bar */}
      <div className="flex items-center justify-between p-3.5 bg-[#071224]/95 border-b border-[#00F0FF]/25 gap-2">
        <div className="flex items-center space-x-3">
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${
              streamHealth === 'online'
                ? 'bg-[#00F0FF] hud-glow-cyan'
                : streamHealth === 'connecting'
                ? 'bg-[#FF9E00] animate-pulse'
                : 'bg-[#EF4444]'
            }`}
          />
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-bold font-hud text-[#FFFFFF]">{device.name}</h4>
              {isBlurams && onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  title="Configure Blurams Cloud Credentials or Direct Stream URL"
                  className="px-2 py-0.5 rounded bg-[#FF9E00]/15 hover:bg-[#FF9E00]/30 border border-[#FF9E00]/40 text-[10px] font-mono text-[#FF9E00] flex items-center gap-1 cursor-pointer"
                >
                  <Key size={10} /> Cloud Key
                </button>
              )}
            </div>
            <div className="flex items-center space-x-2 text-xs text-[#7C99B8] font-mono">
              <span>{device.room}</span>
              <span>&bull;</span>
              <span className="text-[#00F0FF]">{device.brand}</span>
              <span>&bull;</span>
              <span>{device.ip}</span>
            </div>
          </div>
        </div>

        {/* Action Controls (Large touch targets >= 44px for tablet) */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => triggerCameraMotion(device.id, !isMotion)}
            title="Toggle Motion Alert Test"
            className={`touch-btn w-11 h-11 rounded-xl border transition cursor-pointer ${
              isMotion
                ? 'bg-[#EF4444] border-[#EF4444] text-[#FFFFFF]'
                : 'bg-[#081326] border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <ShieldAlert size={17} />
          </button>
          <button
            onClick={() => setShowPtz(!showPtz)}
            title="Toggle PTZ Pad"
            className={`touch-btn w-11 h-11 rounded-xl border transition cursor-pointer ${
              showPtz
                ? 'bg-[#00F0FF] border-[#00F0FF] text-[#050A14]'
                : 'bg-[#081326] border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#00F0FF]'
            }`}
          >
            <Camera size={17} />
          </button>
          <button
            onClick={handleSnapshot}
            title="Capture Instant Snapshot"
            className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#00F0FF] transition cursor-pointer"
          >
            <Download size={17} className={isCapturing ? 'text-[#10B981]' : ''} />
          </button>
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#00F0FF] transition cursor-pointer"
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          {onEdit && (
            <button
              onClick={() => onEdit(device)}
              title="Edit Camera Settings"
              className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#00F0FF] transition cursor-pointer"
            >
              <Edit3 size={17} />
            </button>
          )}
          <button
            onClick={() => {
              if (onDelete) {
                onDelete(device.id);
              } else if (window.confirm(`Are you sure you want to remove ${device.name}?`)) {
                deleteDevice(device.id).catch((err) => alert(err.message));
              }
            }}
            title="Delete Camera"
            className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#EF4444] hover:border-[#EF4444] hover:bg-[#EF4444]/15 transition cursor-pointer"
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      {/* Video Stream Container (Unobstructed 16:9 Feed) */}
      <div className="relative w-full aspect-video bg-[#02050B] flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${streamHealth === 'online' ? 'block' : 'hidden'}`}
        />

        {streamHealth !== 'online' && (
          <div className="w-full h-full bg-[#050A14] flex flex-col items-center justify-center p-6 text-center space-y-3">
            {streamHealth === 'connecting' ? (
              <>
                <Radio className="text-[#00F0FF] animate-pulse" size={36} />
                <div>
                  <p className="text-sm font-hud font-bold text-[#00F0FF]">
                    ESTABLISHING WEBRTC UPLINK...
                  </p>
                  <p className="text-xs text-[#7C99B8] mt-1 font-mono">
                    STREAM: {streamName} ({device.ip}:{device.port || 554})
                  </p>
                </div>
              </>
            ) : (
              <>
                <VideoOff className="text-[#7C99B8]" size={36} />
                <div>
                  <p className="text-sm font-hud font-bold text-[#E2F1FF]">
                    OPTICAL FEED STANDBY
                  </p>
                  <p className="text-xs text-[#7C99B8] mt-1 font-mono">
                    {errorMessage || `RTSP stream @ ${device.ip}:${device.port || 554}`}
                  </p>
                </div>
                <div className="flex items-center space-x-2 mt-2">
                  <button
                    onClick={() => setRetryNonce((n) => n + 1)}
                    className="touch-btn px-5 py-2 rounded-xl bg-[#081326] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/40 text-[#00F0FF] text-xs font-mono font-bold flex items-center space-x-2 transition cursor-pointer"
                  >
                    <RotateCw size={14} />
                    <span>Reconnect Feed</span>
                  </button>
                  {isBlurams && onOpenSettings && (
                    <button
                      onClick={onOpenSettings}
                      className="touch-btn px-4 py-2 rounded-xl bg-[#FF9E00]/20 hover:bg-[#FF9E00]/30 border border-[#FF9E00] text-[#FF9E00] text-xs font-mono font-bold flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <Key size={14} />
                      <span>Set Blurams Login</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Motion Alert Banner */}
        {isMotion && (
          <div className="absolute top-3 left-3 right-3 z-10 py-2 px-4 rounded-xl bg-[#EF4444]/90 text-[#FFFFFF] text-xs font-hud font-bold tracking-wider flex items-center justify-center gap-2 shadow-lg">
            <ShieldAlert size={16} />
            TACTICAL ALERT // MOTION DETECTED
          </div>
        )}

        {/* Touch PTZ Pad Overlay */}
        {showPtz && (
          <div className="absolute bottom-4 right-4 z-30 p-3 rounded-2xl bg-[#050A14]/95 border border-[#00F0FF]/50 shadow-2xl flex flex-col items-center space-y-2.5">
            <span className="text-[10px] font-hud font-bold uppercase text-[#00F0FF]">
              PTZ VECTOR CONTROL
            </span>
            <div className="grid grid-cols-3 gap-1.5 w-36">
              <div />
              <button
                onMouseDown={() => handlePtz('up')}
                className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/30 active:bg-[#00F0FF] active:text-[#050A14] text-[#FFFFFF] transition cursor-pointer"
              >
                <ArrowUp size={18} />
              </button>
              <div />

              <button
                onMouseDown={() => handlePtz('left')}
                className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/30 active:bg-[#00F0FF] active:text-[#050A14] text-[#FFFFFF] transition cursor-pointer"
              >
                <ArrowLeft size={18} />
              </button>
              <button
                onClick={() => handlePtz('stop')}
                className="touch-btn w-11 h-11 rounded-xl bg-[#050A14] border border-[#FF9E00]/40 text-[#FF9E00] text-xs font-mono font-bold transition cursor-pointer"
              >
                STOP
              </button>
              <button
                onMouseDown={() => handlePtz('right')}
                className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/30 active:bg-[#00F0FF] active:text-[#050A14] text-[#FFFFFF] transition cursor-pointer"
              >
                <ArrowRight size={18} />
              </button>

              <div />
              <button
                onMouseDown={() => handlePtz('down')}
                className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/30 active:bg-[#00F0FF] active:text-[#050A14] text-[#FFFFFF] transition cursor-pointer"
              >
                <ArrowDown size={18} />
              </button>
              <div />
            </div>

            <div className="flex space-x-2 w-full pt-1 border-t border-[#00F0FF]/20">
              <button
                onClick={() => handlePtz('zoom_in')}
                className="touch-btn flex-1 py-2 rounded-xl bg-[#081326] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/30 text-[#FFFFFF] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
              >
                <ZoomIn size={14} /> +
              </button>
              <button
                onClick={() => handlePtz('zoom_out')}
                className="touch-btn flex-1 py-2 rounded-xl bg-[#081326] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/30 text-[#FFFFFF] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
              >
                <ZoomOut size={14} /> -
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Camera Tactical Footer */}
      <div className="p-3 bg-[#071224]/95 border-t border-[#00F0FF]/20 flex items-center justify-between text-xs font-mono">
        <span className="text-[#7C99B8]">
          CH: <strong className="text-[#E2F1FF]">{streamName}</strong> &bull;{' '}
          {device.camera?.rtspPath || '/live/ch0'}
        </span>
        <span className={streamHealth === 'online' ? 'text-[#00F0FF] font-bold' : 'text-[#FF9E00]'}>
          {streamHealth === 'online' ? 'WEBRTC LIVE // <250ms' : 'STANDBY'}
        </span>
      </div>
    </div>
  );
};
