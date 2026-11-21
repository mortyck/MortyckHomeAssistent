import React, { useState } from 'react';
import { LayoutGrid, Grid2X2, Square, Camera, VideoOff, Plus } from 'lucide-react';
import { Device } from '../types';
import { WebRtcPlayer } from './WebRtcPlayer';

interface MultiCameraWallProps {
  cameras: Device[];
  selectedRoom: string;
  onAddCamera?: () => void;
  onEditCamera?: (device: Device) => void;
  onDeleteCamera?: (id: string) => void;
  onOpenSettings?: () => void;
}

export const MultiCameraWall: React.FC<MultiCameraWallProps> = ({
  cameras,
  selectedRoom,
  onAddCamera,
  onEditCamera,
  onDeleteCamera,
  onOpenSettings
}) => {
  const [gridMode, setGridMode] = useState<'1x1' | '2x2' | '3x3'>('2x2');

  const filteredCameras = selectedRoom === 'All'
    ? cameras
    : cameras.filter((c) => c.room === selectedRoom);

  const getGridClass = () => {
    switch (gridMode) {
      case '1x1':
        return 'grid-cols-1 max-w-4xl mx-auto';
      case '2x2':
        return 'grid-cols-1 md:grid-cols-2';
      case '3x3':
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
    }
  };

  return (
    <div className="space-y-4">
      {/* Wall Header & Matrix Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <Camera className="text-[#00F0FF]" size={20} />
          <h2 className="text-sm font-bold font-hud text-[#FFFFFF] tracking-wider">
            OPTICAL SURVEILLANCE MATRIX ({filteredCameras.length})
          </h2>
        </div>

        {/* Matrix Grid Mode Selector */}
        <div className="flex items-center space-x-1.5 p-1 bg-[#081326] rounded-xl border border-[#00F0FF]/25">
          <button
            onClick={() => setGridMode('1x1')}
            title="Single Focus (1x1)"
            className={`touch-btn w-10 h-10 rounded-lg transition cursor-pointer ${
              gridMode === '1x1'
                ? 'bg-[#00F0FF] text-[#050A14] font-bold'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <Square size={16} />
          </button>
          <button
            onClick={() => setGridMode('2x2')}
            title="Quad View (2x2)"
            className={`touch-btn w-10 h-10 rounded-lg transition cursor-pointer ${
              gridMode === '2x2'
                ? 'bg-[#00F0FF] text-[#050A14] font-bold'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <Grid2X2 size={16} />
          </button>
          <button
            onClick={() => setGridMode('3x3')}
            title="Matrix View (3x3)"
            className={`touch-btn w-10 h-10 rounded-lg transition cursor-pointer ${
              gridMode === '3x3'
                ? 'bg-[#00F0FF] text-[#050A14] font-bold'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Grid of Video Streams */}
      {filteredCameras.length === 0 ? (
        <div className="p-12 text-center rounded-2xl dash-card flex flex-col items-center justify-center space-y-4">
          <VideoOff className="text-[#7C99B8]" size={40} />
          <div>
            <p className="text-sm font-hud font-bold text-[#FFFFFF]">NO OPTICAL FEEDS IN THIS SECTOR</p>
            <p className="text-xs text-[#7C99B8] mt-1 font-mono">
              Add your CamHi, Wansview, Blurams, or ONVIF/RTSP camera to stream via WebRTC.
            </p>
          </div>
          {onAddCamera && (
            <button
              onClick={onAddCamera}
              className="touch-btn px-6 py-3 rounded-xl bg-[#00F0FF] hover:bg-[#00C8FF] text-[#050A14] text-xs font-bold flex items-center space-x-2 transition cursor-pointer shadow-md"
            >
              <Plus size={16} />
              <span>Add IP Camera</span>
            </button>
          )}
        </div>
      ) : (
        <div className={`grid gap-5 ${getGridClass()}`}>
          {filteredCameras.map((camera) => (
            <WebRtcPlayer
              key={camera.id}
              device={camera}
              onEdit={onEditCamera}
              onDelete={onDeleteCamera}
              onOpenSettings={onOpenSettings}
            />
          ))}
        </div>
      )}
    </div>
  );
};
