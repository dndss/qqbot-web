import { createRequire } from 'node:module'
import { normalizeMediaPart } from '../src/message-media.ts'

const { MessageEvent } = createRequire(import.meta.url)('qq-official-bot')
export const audioName = '97e7417a93a630f8e88558041e7345ae.amr'
export const amrBytes = Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(100, 0x42)])
export const wavBytes = Buffer.alloc(44 + 16000 * 8)
wavBytes.write('RIFF', 0)
wavBytes.writeUInt32LE(wavBytes.length - 8, 4)
wavBytes.write('WAVEfmt ', 8)
wavBytes.writeUInt32LE(16, 16)
wavBytes.writeUInt16LE(1, 20)
wavBytes.writeUInt16LE(1, 22)
wavBytes.writeUInt32LE(8000, 24)
wavBytes.writeUInt32LE(16000, 28)
wavBytes.writeUInt16LE(2, 32)
wavBytes.writeUInt16LE(16, 34)
wavBytes.write('data', 36)
wavBytes.writeUInt32LE(wavBytes.length - 44, 40)

/** Replay the supplied event shape through the installed SDK, without real URLs or credentials. */
export function officialAudioPart() {
  const event = MessageEvent.parse.call({ removeAt() {}, logger: { info() {} } }, 'message.group', {
    id: 'voice-event', message_type: 0, group_id: 'fixture', content: '',
    timestamp: '2026-10-14T23:04:09+08:00', author: { id: 'sender', username: 'Sender' },
    attachments: [{
      content_type: 'voice', filename: audioName, size: 5818,
      url: 'https://audio.example/original', voice_wav_url: 'https://audio.example/copy.wav',
    }],
  })
  const part = event.message[0]
  return normalizeMediaPart(part.type, part.data)
}
