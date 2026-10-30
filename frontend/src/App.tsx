import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
const HowKnowsPage = lazy(() => import('./pages/HowKnowsPage'))
import LoginPage from './pages/LoginPage'
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'))
const LocationsPage = lazy(() => import('./pages/settings/LocationsPage'))
const StatusesPage = lazy(() => import('./pages/settings/StatusesPage'))
const TrackPage = lazy(() => import('./pages/TrackPage'))
const ForgottenPage = lazy(() => import('./pages/ForgottenPage'))
const NotificationsPage = lazy(() => import('./pages/settings/NotificationsPage'))
const QuickOrdersPage = lazy(() => import('./pages/settings/QuickOrdersPage'))
const ChecklistSettingsPage = lazy(() => import('./pages/settings/ChecklistSettingsPage'))
const StaffPage = lazy(() => import('./pages/settings/StaffPage'))
const OrderTypesPage = lazy(() => import('./pages/settings/OrderTypesPage'))
const CompendiumsLayout = lazy(() => import('./pages/compendiums/CompendiumsLayout'))
const DevicesPage = lazy(() => import('./pages/compendiums/DevicesPage'))
const NomenclaturePage = lazy(() => import('./pages/compendiums/NomenclaturePage'))
const CounteragentsPage = lazy(() => import('./pages/compendiums/CounteragentsPage'))
const DictionaryPage = lazy(() => import('./components/DictionaryPage'))
const OrdersPage = lazy(() => import('./pages/OrdersPage'))
const OrderCreatePage = lazy(() => import('./pages/OrderCreatePage'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'))
const AppInstallPage = lazy(() => import('./pages/AppInstallPage'))
import DashboardPage from './pages/DashboardPage'
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const FinanceLayout = lazy(() => import('./pages/finance/FinanceLayout'))
const FinanceCashesPage = lazy(() => import('./pages/finance/FinanceCashesPage'))
const FinanceTransactionsPage = lazy(() => import('./pages/finance/FinanceTransactionsPage'))
const SalaryPage = lazy(() => import('./pages/finance/SalaryPage'))
const SalaryEmployeePage = lazy(() => import('./pages/finance/SalaryEmployeePage'))
const CashItemsPage = lazy(() => import('./pages/compendiums/CashItemsPage'))
const DayNotePage = lazy(() => import('./pages/DayNotePage'))
const SalesPage = lazy(() => import('./pages/SalesPage'))
const StoreLayout = lazy(() => import('./pages/store/StoreLayout'))
const RemainsPage = lazy(() => import('./pages/store/RemainsPage'))
const DocumentsPage = lazy(() => import('./pages/store/DocumentsPage'))
const InventoryPage = lazy(() => import('./pages/store/InventoryPage'))

function Protected({ children }: { children: ReactNode }) {
  const { me, loading, offline, retry } = useAuth()
  if (loading) return <div className="p-6 text-muted">Загрузка…</div>
  if (!me && offline) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Нет связи с сервером</p>
        <p className="max-w-xs text-muted">Проверьте интернет на телефоне. CRM откроется сама, как только связь появится.</p>
        <button type="button" onClick={retry} className="mt-2 rounded-md bg-accent px-5 py-2.5 font-medium text-accent-ink">Повторить</button>
      </div>
    )
  }
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
        {/* Редкие разделы (аналитика, закупки, настройки) грузятся при первом открытии — приложение стартует быстрее */}
        <Suspense fallback={<div className="p-6 text-muted">Загрузка…</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/track/:code" element={<TrackPage />} />
          <Route
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="orders">
              <Route index element={<OrdersPage />} />
              <Route path="new" element={<OrderCreatePage />} />
              <Route path="forgotten" element={<ForgottenPage />} />
              <Route path=":orderId" element={<OrderDetailPage />} />
            </Route>
            <Route path="sales" element={<SalesPage />} />
            <Route path="day" element={<DayNotePage />} />
            <Route path="store" element={<StoreLayout />}>
              <Route index element={<Navigate to="remains" replace />} />
              <Route path="remains" element={<RemainsPage />} />
              <Route path="purchase" element={<DocumentsPage key="purchase" type="purchase" />} />
              <Route path="move" element={<DocumentsPage key="move" type="move" />} />
              <Route path="cancellation" element={<DocumentsPage key="cancellation" type="cancellation" />} />
              <Route path="inventory" element={<InventoryPage />} />
            </Route>
            <Route path="tasks" element={<TasksPage />} />
            {/* Старые «Доски» (первая версия закупок) убраны — закладки ведут в «Закупки» */}
            <Route path="boards/*" element={<Navigate to="/zakupki" replace />} />
            <Route path="zakupki" element={<PurchasesPage />} />
            <Route path="apps" element={<AppInstallPage />} />
            <Route path="finance" element={<FinanceLayout />}>
              <Route index element={<Navigate to="cashes" replace />} />
              <Route path="cashes" element={<FinanceCashesPage />} />
              <Route path="transactions" element={<FinanceTransactionsPage />} />
              <Route path="salary" element={<SalaryPage />} />
              <Route path="salary/:employeeId" element={<SalaryEmployeePage />} />
            </Route>
            <Route path="analytics" element={<AnalyticsPage />} />
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
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="quick-orders" element={<QuickOrdersPage />} />
              <Route path="checklist" element={<ChecklistSettingsPage />} />
            </Route>
            <Route path="*" element={<Stub title="Страница не найдена" task="—" />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
