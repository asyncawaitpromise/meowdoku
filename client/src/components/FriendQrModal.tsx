import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface FriendQrModalProps {
  friendLink: string
  onClose: () => void
}

const QR_PIXEL_SIZE = 480

export default function FriendQrModal({ friendLink, onClose }: FriendQrModalProps) {
  const [qrImageUrl, setQrImageUrl] = useState('')

  useEffect(() => {
    void QRCode.toDataURL(friendLink, { width: QR_PIXEL_SIZE, margin: 2 }).then(setQrImageUrl)
  }, [friendLink])

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div className="modal-box max-w-xs text-center space-y-3" onClick={event => event.stopPropagation()}>
        <h3 className="font-bold text-lg">Scan to add me</h3>
        {qrImageUrl ? (
          <img src={qrImageUrl} alt="Friend link QR code" className="w-full rounded bg-white" />
        ) : (
          <span className="loading loading-spinner" />
        )}
        <p className="text-xs opacity-60">Scanning opens your friend link and sends you a request.</p>
        <button className="btn btn-sm btn-primary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
