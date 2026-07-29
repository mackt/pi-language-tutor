declare module 'glimpseui' {
  import { EventEmitter } from 'node:events'

  export interface GlimpseOpenOptions {
    width?: number
    height?: number
    title?: string
    hidden?: boolean
    autoClose?: boolean
  }

  export class GlimpseWindow extends EventEmitter {
    on(event: 'ready', listener: (info: unknown) => void): this
    on(event: 'message', listener: (data: unknown) => void): this
    on(event: 'closed', listener: () => void): this
    on(event: 'error', listener: (error: Error) => void): this
    send(js: string): void
    show(options?: { title?: string }): void
    close(): void
    loadFile(path: string): void
  }

  export function open(html: string, options?: GlimpseOpenOptions): GlimpseWindow
}
