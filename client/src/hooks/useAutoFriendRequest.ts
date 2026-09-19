import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../store/authStore.ts'
import { useFriendsStore } from '../store/friendsStore.ts'

export type AutoFriendRequestStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string }

export function useAutoFriendRequest(friendCodeFromLink: string | null) {
  const ownFriendCode = useAuthStore(state => state.user?.friend_code)
  const sendRequest = useFriendsStore(state => state.sendRequest)
  const [status, setStatus] = useState<AutoFriendRequestStatus>({ kind: 'idle' })
  const handledCodeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!friendCodeFromLink || handledCodeRef.current === friendCodeFromLink) return
    if (friendCodeFromLink === ownFriendCode) return

    handledCodeRef.current = friendCodeFromLink
    setStatus({ kind: 'sending' })
    void sendRequest(friendCodeFromLink).then(result => {
      setStatus(
        result.success
          ? { kind: 'sent' }
          : { kind: 'failed', message: result.error ?? 'Failed to send request' },
      )
    })
  }, [friendCodeFromLink, ownFriendCode, sendRequest])

  return status
}
