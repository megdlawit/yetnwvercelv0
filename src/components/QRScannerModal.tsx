/**
 * QRScannerModal — QR Anchor Scan modal.
 * Matches image 2 design: centered card with QR icon at top,
 * square viewfinder with a full bordered frame + horizontal divider,
 * description text, and Allow Sensor Access pill button.
 * Dark overlay background, card centered on screen.
 */
import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode } from 'lucide-react';
import { QRScanner, QRAnchorPayload } from '@/lib/QRScanner';

interface QRScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (payload: QRAnchorPayload) => void;
}

/** The square QR viewfinder: bordered frame with a horizontal divider line */
const QRViewfinder: React.FC = () => (
  <div
    className="relative flex items-center justify-center rounded-2xl"
    style={{
      width: 180,
      height: 180,
      background: 'hsl(142 25% 96%)',
      border: '2.5px solid hsl(152 70% 18%)',
    }}
  >
    {/* Horizontal divider line through middle */}
    <div
      className="absolute left-0 right-0"
      style={{
        top: '50%',
        height: 1.5,
        background: 'hsl(152 70% 18%)',
        transform: 'translateY(-50%)',
      }}
    />

    {/* Hidden video for actual scanning */}
    {/* (video element stays off-screen; scanning happens via ref) */}
  </div>
);

const QRScannerModal: React.FC<QRScannerModalProps> = ({ open, onClose, onScan }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QRScanner | null>(null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCameraGranted(false);
    return () => {
      scannerRef.current?.stop();
    };
  }, [open]);

  const handleAllowAccess = async () => {
    setError(null);
    const scanner = new QRScanner();
    scannerRef.current = scanner;
    const timeout = setTimeout(() => {
      if (videoRef.current) {
        scanner.start(
          videoRef.current,
          (payload) => { setCameraGranted(false); onScan(payload); },
          (err) => { setCameraGranted(false); setError(err); }
        );
        setCameraGranted(true);
      }
    }, 100);
    return () => clearTimeout(timeout);
  };

  const handleClose = () => {
    scannerRef.current?.stop();
    setCameraGranted(false);
    setError(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(15, 20, 15, 0.85)', backdropFilter: 'blur(2px)' }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="bg-white rounded-3xl mx-5 w-full text-center overflow-visible"
            style={{
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              maxWidth: 300,
              paddingBottom: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* QR Code icon — overlapping top */}
            <div className="flex justify-center" style={{ marginTop: -28 }}>
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: 'hsl(118 50% 88%)',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                }}
              >
                <QrCode className="w-6 h-6" style={{ color: 'hsl(152 55% 30%)' }} strokeWidth={2} />
              </div>
            </div>

            <div className="px-6 pt-4">
              <h2 className="text-lg font-black text-gray-900 mb-5">QR Anchor Scan</h2>

              {/* Viewfinder */}
              <div className="flex justify-center mb-5">
                <div className="relative">
                  <QRViewfinder />
                  {/* Hidden video for camera */}
                  <video
                    ref={videoRef}
                    className="absolute rounded-2xl object-cover"
                    style={{
                      inset: 2,
                      opacity: cameraGranted ? 1 : 0,
                      width: 'calc(100% - 4px)',
                      height: 'calc(100% - 4px)',
                      transition: 'opacity 0.3s',
                    }}
                    playsInline
                    muted
                  />
                </div>
              </div>

              {/* Description */}
              <p className="text-sm leading-relaxed mb-4 px-1" style={{ color: 'hsl(0 0% 45%)' }}>
                Point at a sign QR to confirm your location on the map.
              </p>

              {error && (
                <p className="text-xs text-red-500 mb-4">{error}</p>
              )}

              <button
                onClick={handleAllowAccess}
                className="w-full py-4 rounded-full font-bold text-sm text-white active:scale-95 transition-transform"
                style={{ background: 'hsl(152 65% 15%)' }}
              >
                Allow Sensor Access
              </button>
              <p className="text-xs text-muted-foreground mt-3">
                If camera access is blocked, allow it in your browser settings and reopen this panel.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QRScannerModal;
