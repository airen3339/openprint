/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端基地址，如 https://print.example.com；配置后设计器切云端仓库（§4） */
  readonly VITE_OPENPRINT_API_BASE?: string
  /** 可选：Bearer 鉴权 token */
  readonly VITE_OPENPRINT_API_TOKEN?: string
  /**
   * 可选：本地打印客户端基地址，覆盖出厂默认 http://127.0.0.1:18888。
   * 例：VITE_OPENPRINT_PRINTER_BASE=http://192.168.1.20:19000
   * 优先级低于「设置 → 本地打印」里手填的 IP/端口。
   */
  readonly VITE_OPENPRINT_PRINTER_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
