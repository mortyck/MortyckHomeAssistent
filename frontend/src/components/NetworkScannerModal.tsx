import React, { useState } from 'react';
import { Radar, X, Plus, Wifi, RefreshCw } from 'lucide-react';
import { ScanResult } from '../types';
import { startNetworkScan, fetchScanResults } from '../services/api';

interface NetworkScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDeviceForOnboard: (scan: ScanResult) => void;
}

export const NetworkScannerModal: React.FC<NetworkScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectDeviceForOnboard
}) => {
  const [subnet, setSubnet] = useState('192.168.1');
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to scan local network');

  if (!isOpen) return null;

  const handleStartScan = async () => {
    setIsScanning(true);
    setStatusMessage(`Scanning subnet ${subnet}.0/24 on IoT ports (6668, 554, 8899)...`);
    setResults([]);

    try {
      await startNetworkScan(subnet);

      const pollTimer = setInterval(async () => {
        const data = await fetchScanResults();
        setResults(data.results);
        if (!data.isScanning) {
          clearInterval(pollTimer);
          setIsScanning(false);
          setStatusMessage(`Scan complete. Discovered ${data.results.length} IoT device(s).`);
        }
      }, 1500);
    } catch {
      setIsScanning(false);
      setStatusMessage('Network scan failed. Check local network.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/80 p-4">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#1A1D24] border border-[#2A2E39] p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2A2E39]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#262A34] text-[#10B981] flex items-center justify-center">
              <Radar className={isScanning ? 'animate-spin' : ''} size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#FFFFFF]">Local Network Scanner</h3>
              <p className="text-xs text-[#8E95A5]">
                Auto-discover Tuya, Calex, Amorom, CamHi & Wansview on LAN
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="touch-btn w-10 h-10 rounded-lg text-[#8E95A5] hover:text-[#FFFFFF] transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Input & Scan Button */}
        <div className="py-4 border-b border-[#2A2E39] flex items-center space-x-3">
          <div className="flex-1 flex items-center bg-[#0F1115] rounded-xl px-4 py-3 border border-[#2A2E39]">
            <Wifi size={18} className="text-[#8E95A5] mr-2" />
            <span className="text-sm text-[#8E95A5] mr-1 font-mono">Subnet:</span>
            <input
              type="text"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
              placeholder="192.168.1"
              className="bg-transparent text-sm text-[#FFFFFF] font-mono focus:outline-none w-32"
            />
            <span className="text-sm text-[#8E95A5] font-mono">.0/24</span>
          </div>

          <button
            onClick={handleStartScan}
            disabled={isScanning}
            className="touch-btn px-6 py-3 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#FFFFFF] font-bold text-sm transition cursor-pointer disabled:opacity-50"
          >
            {isScanning ? (
              <>
                <RefreshCw size={16} className="animate-spin mr-2" /> Scanning...
              </>
            ) : (
              <>
                <Radar size={16} className="mr-2" /> Scan Subnet
              </>
            )}
          </button>
        </div>

        {/* Status Text */}
        <div className="py-2.5 text-xs text-[#8E95A5] flex items-center gap-2 font-medium">
          <span className={`w-2.5 h-2.5 rounded-full ${isScanning ? 'bg-[#F59E0B] animate-ping' : 'bg-[#10B981]'}`} />
          {statusMessage}
        </div>

        {/* Discovered Device List */}
        <div className="flex-1 overflow-y-auto space-y-3 my-2 pr-1">
          {results.length === 0 ? (
            <div className="py-12 text-center text-[#8E95A5] text-sm">
              {isScanning ? 'Probing 254 subnet addresses...' : 'Click "Scan Subnet" to begin.'}
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-[#0F1115] border border-[#2A2E39] flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-[#FFFFFF] font-mono">{item.ip}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[#262A34] text-[#10B981]">
                      {item.suggestedBrand}
                    </span>
                    <span className="text-xs text-[#8E95A5] uppercase">
                      {item.suggestedCategory}
                    </span>
                  </div>
                  <div className="text-xs text-[#8E95A5] mt-1 font-mono">
                    MAC: {item.mac || 'N/A'} &bull; Ports: {item.openPorts.join(', ')}
                  </div>
                </div>

                <button
                  onClick={() => {
                    onSelectDeviceForOnboard(item);
                    onClose();
                  }}
                  className="touch-btn px-4 py-2 rounded-xl bg-[#262A34] hover:bg-[#FFFFFF] text-[#FFFFFF] hover:text-[#0F1115] text-sm font-bold transition cursor-pointer"
                >
                  <Plus size={16} className="mr-1" /> Onboard
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
