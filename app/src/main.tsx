import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { deleteLegacyDeviceDb, requestPersistentStorage } from './orders/store'

void requestPersistentStorage()
void deleteLegacyDeviceDb()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
