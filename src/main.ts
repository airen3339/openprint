import 'virtual:uno.css'
import './assets/main.css'
import './theme/brand.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { getBackendConfig } from './config/backend'
import { createHttpRepository } from './repository/http-repo'
import { createDataSourceHttp } from './repository/http-datasource'
import { useDesignerStore } from './design/stores/designer'
import { useDataSourceStore } from './design/stores/dataSource'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 后端对接：仅当配置了 VITE_OPENPRINT_API_BASE 才切云端仓库；
// 未配置时 designer 用 localStorage、dataSource 用内置 Mock（主任铁律：无后端全链路可用）。
const backend = getBackendConfig()
if (backend) {
  const designerStore = useDesignerStore(pinia)
  const dataSourceStore = useDataSourceStore(pinia)
  designerStore.setRepository(createHttpRepository(backend.options), 'cloud')
  dataSourceStore.setRepository(createDataSourceHttp(backend.options))
}

app.mount('#app')
