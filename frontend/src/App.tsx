import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import HowKnowsPage from './pages/HowKnowsPage'
import LoginPage from './pages/LoginPage'
import SettingsLayout from './pages/settings/SettingsLayout'
import LocationsPage from './pages/settings/LocationsPage'
import StatusesPage from './pages/settings/StatusesPage'
import StaffPage from './pages/settings/StaffPage'
import OrderTypesPage from './pages/settings/OrderTypesPage'
import CompendiumsLayout from './pages/compendiums/CompendiumsLayout'
import DevicesPage from './pages/compendiums/DevicesPage'
import NomenclaturePage from './pages/compendiums/NomenclaturePage'
import CounteragentsPage from './pages/compendiums/CounteragentsPage'
import DictionaryPage from './components/DictionaryPage'
import OrdersPage from './pages/OrdersPage'
import OrderCreatePage from './pages/OrderCreatePage'
import OrderDetailPage from './pages/OrderDetailPage'
import FinanceLayout from './pages/finance/FinanceLayout'
import FinanceCashesPage from './pages/finance/FinanceCashesPage'
import FinanceTransactionsPage from './pages/finance/FinanceTransactionsPage'
import CashItemsPage from './pages/compendiums/CashItemsPage'

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
            <Route path="orders">
              <Route index element={<OrdersPage />} />
              <Route path="new" element={<OrderCreatePage />} />
              <Route path=":orderId" element={<OrderDetailPage />} />
            </Route>
            <Route path="sales/*" element={<Stub title="Продажи" task="T-30" />} />
            <Route path="store/*" element={<Stub title="Склад" task="T-28, T-29" />} />
            <Route path="tasks/*" element={<Stub title="Задачи" task="этап 2" />} />
            <Route path="finance" element={<FinanceLayout />}>
              <Route index element={<Navigate to="cashes" replace />} />
              <Route path="cashes" element={<FinanceCashesPage />} />
              <Route path="transactions" element={<FinanceTransactionsPage />} />
            </Route>
            <Route path="analytics/*" element={<Stub title="Аналитика" task="этап 2" />} />
            <Route path="compendiums" element={<CompendiumsLayout />}>
              <Route index element={<Navigate to="how-knows" replace />} />
              <Route path="how-knows" element={<HowKnowsPage />} />
              <Route path="problems" element={<DictionaryPage config={{ title: 'Неисправности', path: '/problems', permission: 'problemAccess' }} />} />
              <Route path="complete-sets" element={<DictionaryPage config={{ title: 'Комплектация', path: '/complete-sets', permission: 'completeSetAccess' }} />} />
              <Route path="measures" element={<DictionaryPage config={{ title: 'Единицы измерения', path: '/measures', permission: 'measureAccess', fields: [{ name: 'is_float', label: 'Дробное количество', type: 'checkbox', defaultValue: false }] }} />} />
              <Route path="counteragent-types" element={<DictionaryPage config={{ title: 'Типы контрагентов', path: '/counteragent-types', permission: 'counteragentAccess', fields: [{ name: 'sort', label: 'Порядок', type: 'number', defaultValue: 0 }] }} />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="products" element={<NomenclaturePage isWork={false} />} />
              <Route path="works" element={<NomenclaturePage isWork />} />
              <Route path="counteragents" element={<CounteragentsPage />} />
              <Route path="cash-items" element={<CashItemsPage />} />
            </Route>
            <Route path="compendiums/*" element={<Stub title="Справочники" task="T-14" />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="locations" replace />} />
              <Route path="locations" element={<LocationsPage />} />
              <Route path="statuses" element={<StatusesPage />} />
              <Route path="order-types" element={<OrderTypesPage />} />
              <Route path="staff" element={<StaffPage />} />
            </Route>
            <Route path="*" element={<Stub title="Страница не найдена" task="—" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
