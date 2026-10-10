import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadAccount } from './auth/account'
import { AuthProvider } from './auth/AuthProvider'
import { deleteLegacyDatabases, requestPersistentStorage } from './orders/store'

void requestPersistentStorage()
void deleteLegacyDatabases([loadAccount()?.id].filter((id): id is string => Boolean(id)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
