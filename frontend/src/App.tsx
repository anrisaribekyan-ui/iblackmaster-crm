import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import HowKnowsPage from './pages/HowKnowsPage'
import LoginPage from './pages/LoginPage'

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <div className="p-6 text-muted">Загрузка…</div>
  if (!me) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Заглушка раздела, пока его не сделали. task — номер задачи из TASKS.md. */
function Stub({ title, task }: { title: string; task: string }) {
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="text-muted">Раздел в разработке ({task}).</p>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<Stub title="Главная" task="этап 2" />} />
            <Route path="orders/*" element={<Stub title="Заказы" task="T-20…T-27" />} />
            <Route path="sales/*" element={<Stub title="Продажи" task="T-30" />} />
            <Route path="store/*" element={<Stub title="Склад" task="T-28, T-29" />} />
            <Route path="tasks/*" element={<Stub title="Задачи" task="этап 2" />} />
            <Route path="finance/*" element={<Stub title="Финансы" task="T-31, T-32" />} />
            <Route path="analytics/*" element={<Stub title="Аналитика" task="этап 2" />} />
            <Route path="compendiums/how-knows" element={<HowKnowsPage />} />
            <Route path="compendiums/*" element={<Stub title="Справочники" task="T-10…T-14" />} />
            <Route path="settings/*" element={<Stub title="Настройки" task="T-03…T-08" />} />
            <Route path="*" element={<Stub title="Страница не найдена" task="—" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
