# Задачи — этап 1 (ядро)

Как работать: бери первую задачу без отметки, выполняй по `.clinerules`, ставь `[x]`, коммить, пушь.
Отметки: `[ ]` не начата · `[x]` готово · `[!]` застрял · `[?]` вопрос к Claude · `[R]` проверено Claude.

Каждая задача — отдельный новый чат в Cline. Порядок важен: следующие задачи опираются на предыдущие.

---

## Блок 0. Окружение

### [R] T-01. Проверить, что проект запускается
Ничего не пиши. Выполни:
1. `cd backend && pip install -r requirements.txt && python -m pytest -q` — должно быть «20 passed».
2. `cd frontend && npm install && npm run build` — без ошибок.
Если всё зелёное — поставь `[x]`, закоммить `T-01: окружение проверено`. Если нет — `[!]` с текстом ошибки.

### [R] T-02. Нормализация телефонов
Файл `backend/app/utils/phone.py` (+ пустой `backend/app/utils/__init__.py`):
- `normalize_phone(raw: str) -> str | None` — оставляет только цифры; 11 цифр на 8 → заменить 8 на 7;
  10 цифр → добавить 7 в начало; меньше 10 цифр → None.
- `format_phone(digits: str) -> str` — `79161866119` → `+7 (916) 186-61-19`; не 11 цифр → вернуть как есть.
Тесты `backend/tests/test_phone.py`: «8 (916) 186-61-19», «+7 916 1866119», «9161866119», «123», форматирование.

---

## Блок 1. Настройки (бэкенд)

### [R] T-03. API локаций
Файл `backend/app/api/locations.py`, префикс `/locations`. Модель `Location` (+ `stores`).
- `GET /locations` — активные локации, к которым у сотрудника есть доступ (`location_ids(me)`; пусто = все),
  по `sort`. В ответе: id, name, address, phones, color, sort, stores[{id, name, is_default}].
- `POST /locations`, `PUT /locations/{id}` — право `settingAccess`. Поля: name (обяз.), address, phones, color (#RRGGBB), sort.
- `DELETE /locations/{id}` — `settingAccess`, мягко: is_active=False. Нельзя, если это последняя активная локация (BusinessError).
Тесты: список (3 локации из сида), создание, правка, удаление, 403 для роли без settingAccess
(создай в тесте роль с пустыми permissions и сотрудника с ней, залогинь).
Подсказка для теста без прав: сделай фикстуру `make_user(db, permissions=[...])` в `tests/conftest.py` — можно, это не запрещённый файл.

### [R] T-04. API складов
Файл `backend/app/api/stores.py`, префикс `/stores`.
- `GET /stores?location_id=` — склады (только доступных локаций).
- `POST`, `PUT /stores/{id}` — `storeSettingAccess`. Поля: location_id, name, is_default (если True — у остальных складов этой локации сбросить).
- `DELETE` — мягко; нельзя, если на складе есть остатки (StockBalance.quantity > 0) → BusinessError «На складе есть товар».
Тесты: создание, is_default переключается, запрет удаления склада с остатком (остаток создай через `stock.receive`).

### [R] T-05. API касс (без операций с деньгами)
Файл `backend/app/api/cash_registers.py`, префикс `/cash-registers`.
- `GET /cash-registers` — кассы доступных локаций + глобальные. Поля cash_balance/bank_balance отдавать ТОЛЬКО
  при праве `moneyCashRegisterAccess`, иначе null.
- `POST`, `PUT /{id}` — `changeCashRegisterAccess`. Поля: name, location_id (null = глобальная), accepts_cash,
  accepts_bank, bank_percent (Decimal 0–100), allow_negative, allow_internal_move, is_default.
  Поля балансов в схеме ввода ОТСУТСТВУЮТ.
- `DELETE /{id}` — в архив (is_active=False); нельзя, если остаток ≠ 0.
Тесты: без права moneyCashRegisterAccess балансы null; нельзя передать cash_balance (поле игнорируется/422); архивирование.

### [x] T-06. API статусов заказа
Файл `backend/app/api/order_statuses.py`, префикс `/order-statuses`.
- `GET /order-statuses` — все активные, сгруппированные: `[{group, title, statuses:[...]}]` в порядке групп
  new, inWork, wait, finish, closed (заголовки — `STATUS_GROUP_TITLES`), внутри по sort.
- `POST`, `PUT /{id}` — `settingAccess`. Поля: group, name, client_name, color, sort, pay_required,
  comment_mode (none|optional|required), role_access ({role_id: {view, set, change}}).
- `DELETE /{id}` — мягко; нельзя, если есть незакрытые заказы в этом статусе, и нельзя удалить последний статус группы.
Тесты: группировка и порядок (14 статусов из сида — ответ Claude: в карточке была опечатка, верно 14), создание, запрет удаления последнего в группе.

### [R] T-07. API типов заказов и редактор формы
Файл `backend/app/api/order_types.py`, префикс `/order-types`.
- `GET /order-types` — активные типы по sort.
- `POST`, `PUT /{id}`, `DELETE /{id}` (мягко) — `settingAccess`. При создании типа скопировать поля формы
  из первого типа (FormField с новым order_type_id).
- `GET /order-types/{id}/fields` — поля формы по `place`.
- `PUT /order-types/{id}/fields` — `settingAccess`, принимает весь список полей
  [{id?, key, label, group, data_type, place, is_required, is_only_dictionary, default_value, items, is_visible}];
  существующие обновить, новых (без id) — создать с key `custom_<короткий uuid>` и group `custom`,
  отсутствующие в списке — is_visible=False. Поле `name` (имя клиента) нельзя сделать необязательным.
Тесты: копирование полей при создании типа, сохранение формы, запрет снять обязательность с name.

### [R] T-08. API ролей и сотрудников
Файл `backend/app/api/staff.py`.
- `GET /permissions` — каталог прав из `app.permissions` (PERMISSIONS сгруппировать по section + SCOPES).
- `GET /roles`, `POST /roles`, `PUT /roles/{id}`, `DELETE /roles/{id}` — `settingAccess`. Проверять, что все коды
  в permissions есть в PERMISSIONS, а значения scopes — в SCOPES[key].options (иначе BusinessError).
  Удалить нельзя, если к роли привязаны сотрудники, и нельзя удалить роль с is_system=True.
- `GET /employees` — `settingAccess` (без поля password_hash!). `POST /employees` — с паролем (мин. 8 символов),
  `PUT /employees/{id}` — без пароля, `POST /employees/{id}/password` — смена пароля,
  `DELETE /employees/{id}` — is_active=False. Владельца (is_owner) нельзя отключить или сменить ему роль.
  Поле location_ids — список доступных локаций.
- `GET /employees/short?location_id=&master=1|manager=1` — для выпадающих списков (id, short_name) всем
  авторизованным; master=1 — только у кого в роли isMasterAccess, manager=1 — isManagerAccess.
Тесты: неизвестный код права → 400, пароль не возвращается, владельца нельзя отключить, /employees/short фильтрует.

---

## Блок 2. Настройки (фронтенд)

### [x] T-09. Страница «Настройки»: локации, склады, кассы
`frontend/src/pages/settings/` — раздел с левым подменю: Локации, Статусы, Типы заказов, Сотрудники и роли.
В этой задаче — только «Локации»: список локаций (цветная метка, адрес), у каждой — склады и кассы
(название, нал/безнал, % банка). Добавление/правка через модальное окно (сделай общий компонент
`src/components/Modal.tsx`). Маршруты `/settings/locations` (по умолчанию для `/settings`).

### [x] T-09b. Настройки: статусы заказа
`/settings/statuses`: 5 колонок-групп, в каждой статусы цветными плашками. Клик — модальное окно правки
(название, текст для клиента, цвет, требует оплаты, комментарий, права ролей таблицей роль × [видит, ставит, меняет]).
Кнопка «+ статус» в каждой группе.

### [x] T-09c. Настройки: сотрудники и роли
`/settings/staff`: две вкладки. «Сотрудники» — таблица (имя, email, роль, локации, активен), добавить/изменить/
сменить пароль/отключить. «Роли» — список ролей; редактор роли: права чекбоксами, сгруппированными по разделам
(из `GET /permissions`), дочерние права с отступом и неактивны, пока не включён родитель; права-выборы — селектами.

### [ ] T-09d. Настройки: типы заказов и редактор формы
`/settings/order-types`: список типов слева, справа — поля формы таблицей (метка, тип данных, место, обязательное,
только из справочника, показывать). Кнопки вверх/вниз меняют `place` внутри группы. «+ поле» добавляет пользовательское.

---

## Блок 3. Справочники

### [R] T-10. API простых справочников
По образцу `how_knows.py` сделай 4 роутера: `/problems` (Problem, право problemAccess),
`/complete-sets` (CompleteSet, completeSetAccess), `/measures` (Measure, measureAccess; поле is_float),
`/counteragent-types` (CounteragentType, counteragentAccess). У Problem/CompleteSet нет is_active —
удаление физическое допустимо (это подсказки для ввода). GET — всем авторизованным, с параметром `q` (поиск по подстроке, без учёта регистра).
Тесты на каждый роутер (можно одним параметризованным тестом).

### [R] T-11. API устройств
Файл `backend/app/api/devices.py`: `/device-types`, `/brands?device_type_id=`, `/device-models?brand_id=`,
CRUD с правом brandModelDeviceAccess. Плюс `GET /devices/suggest?q=` — до 20 подсказок «Бренд Модель» для
автодополнения в форме заказа (ищет по brand.name и device_model.name).
Тесты: дерево и подсказки.

### [R] T-12. API номенклатуры
Файл `backend/app/api/nomenclature.py`.
- `GET /nomenclature?q=&is_work=&group_id=&location_id=&page=` — по 50; поиск по name/article/code;
  в ответе цены (по типам цен), для товаров — остаток на складах выбранной локации (сумма StockBalance.quantity).
  purchase_price — только при праве purchasePriceAccess.
- `POST`, `PUT /nomenclature/{id}` — nomenclatureAccess для товаров, workAccess для работ. code — следующий max+1.
  Цены: `prices: [{price_type_id, price}]`.
- `DELETE` — мягко (is_deleted).
- `GET/POST/PUT/DELETE /nomenclature-groups` — дерево групп. `GET /price-types`.
- `GET /nomenclature/search?q=&location_id=` — быстрый поиск для добавления в заказ/чек: до 20 позиций с ценами и остатком.
Тесты: автокод, цены, остаток в выдаче, скрытие purchase_price без права.

### [R] T-13. API контрагентов
Файл `backend/app/api/counteragents.py` (право counteragentAccess на запись; читать могут все с доступом к заказам).
- `GET /counteragents?q=&is_vendor=&page=` — поиск по имени и телефону (телефон нормализуй через T-02). Поставщиков
  (is_vendor) видят только с правом counteragentSellerAccess.
- `GET /counteragents/by-phone?phone=` — для формы заказа: первый найденный или null.
- `GET /counteragents/{id}` — карточка + `orders_count`, `balance`.
- `POST`, `PUT /{id}` — телефоны сохранять нормализованными (через запятую); balance в схеме ввода нет.
- `DELETE /{id}` — is_deleted=True.
Тесты: поиск по «8 (916)…» находит «79161866119», by-phone, нельзя задать balance.

### [ ] T-14. Фронтенд справочников
Раздел `/compendiums` с подменю: Источники рекламы (уже есть), Неисправности, Комплектация, Единицы измерения,
Типы контрагентов, Устройства, Товары, Работы, Контрагенты.
Сделай общий компонент `src/components/DictionaryPage.tsx` для простых справочников (по образцу HowKnowsPage)
и отдельные страницы: Устройства (три колонки тип → бренд → модель), Товары/Работы (таблица с поиском, карточка
в модалке с ценами по типам цен), Контрагенты (таблица: имя, телефоны в формате +7 (…), баланс; карточка).

---

## Блок 4. Заказы

### [R] T-20. API: создать заказ и открыть карточку
Файл `backend/app/api/orders.py`, префикс `/orders`. Логика — SPEC.md §2.2.
- `POST /orders` — право createOrderAccess + check_location. Вход: location_id, order_type_id,
  counteragent ({id} или {name, phones, ...} — тогда создать), поля устройства и доп.инфо, custom_fields,
  master_id, manager_id. Проверить обязательные поля по FormField типа (BusinessError «Заполните поле «…»»).
  Номер — `orders.next_order_number`, статус — первый в группе new, история `created`.
- `GET /orders/{id}` — карточка: все поля, статус, тип, клиент (имя, телефоны, баланс), мастер/менеджер (short_name),
  positions, история (по дате, новые сверху), транзакции заказа (не удалённые), debt.
  Себестоимость/прибыль позиций — только при purchasePriceAccess/marginPriceAccess.
  Доступ: check_location + scope orders («own» — только если me мастер/менеджер/создатель).
Тесты: создание с новым клиентом, с существующим, номер A15843, обязательное поле, чужая локация → 403.

### [R] T-21. API: список заказов
`GET /orders` в том же файле. Параметры: location_id, tab (new|inWork|wait|finish|closed|all), status_id,
order_type_id, master_id, manager_id, date_from, date_to, urgent, overdue, q, page (по 50).
Сортировка: новые сверху. Ответ: {items, total, counts: {new, inWork, wait, finish, closed}}.
Поиск q: номер, телефон (нормализовать), имя клиента, серийный номер, модель. Удалённые не показывать
(кроме `deleted=1` при праве viewDeleteOrderAccess). Учитывать scope orders (none → 403, own → только свои).
Тесты: вкладки и счётчики, поиск по телефону, overdue, own-скоуп.

### [R] T-22. API: изменить информацию о заказе
`PUT /orders/{id}` — право changeOrderInfoAccess; смена master_id — changeOrderMasterAccess,
manager_id — changeOrderManagerAccess. Только изменившиеся поля → история `info_changed` с data
{поле: [было, стало]}. Нельзя менять location_id и number. `DELETE /orders/{id}` (deleteOrderAccess) —
is_deleted=True + история `deleted`; `POST /orders/{id}/restore` — обратно.
Тесты: история с диффом, 403 на смену мастера без права, удаление/восстановление.

### [R] T-23. API: работы и запчасти в заказе
- `POST /orders/{id}/positions` — changeOrderPositionAccess. Вход: nomenclature_id или (name, is_work),
  quantity, price, performer_id, store_id (для запчасти), guarantee_days. Запчасть без работы в заказе —
  только с createOrderProductAccess. Цена ниже минимальной (тип цены is_minimal) — только с minPriceAccess.
  Использовать `orders.add_position`.
- `PUT /orders/{id}/positions/{pos_id}` — цена/цена со скидкой через `orders.update_position_price`.
- `DELETE /orders/{id}/positions/{pos_id}` — `orders.remove_position`.
- `PUT /orders/{id}/discount` — {discount_percent | discount_sum} (discountSaleAccess), затем `orders.recalc_totals`.
Тесты: списание со склада, возврат при удалении, запрет ниже минимальной цены, скидка.

### [R] T-24. API: статус и комментарии
- `POST /orders/{id}/status` — {status_id, comment} → `orders.change_status`.
- `POST /orders/{id}/comments` — {text} → история `comment`.
- `GET /orders/{id}/history` — лента с именем сотрудника, названием и цветом статуса.
Тесты: смена статуса пишет историю, required-комментарий, закрытие неоплаченного → 400.

### [R] T-25. API: оплаты заказа
- `POST /orders/{id}/payments` — {cash_register_id, amount, is_bank, note} → `orders.pay`
  (право operationCashRegisterAccess; касса — доступной локации или глобальная).
- `POST /orders/{id}/refunds` — returnOrderProductAccess → `orders.refund`.
- `DELETE /orders/{id}/payments/{tx_id}` — changeTransactionAccess → `orders.delete_payment`.
Тесты: оплата меняет debt, возврат, удаление оплаты, касса чужой локации → 403.

### [ ] T-26. Фронтенд: список заказов
`/orders` — как в LiveSklad (SPEC §2.4): сверху выбор локации, кнопка «Создать», поиск; вкладки-счётчики;
таблица; клик по строке → `/orders/:id`. Статус — цветная плашка. Срочные — красный значок.
Фильтры в выпадающей панели. Состояние вкладки и фильтров — в URL (query-параметры).

### [ ] T-27. Фронтенд: создание заказа
`/orders/new` — выбрать тип заказа → форма из `GET /order-types/{id}/fields` (ряды и колонки по `place`).
Телефон: при вводе 10+ цифр искать клиента (`/counteragents/by-phone`) и подставлять. Марка/модель —
автодополнение (`/devices/suggest`), неисправность и комплектация — множественный выбор с подсказками
(`/problems`, `/complete-sets`) и возможностью вписать своё. После создания → карточка заказа.

### [ ] T-27b. Фронтенд: карточка заказа
`/orders/:id`: шапка (номер, статус-выпадашка, кнопки Выдать / Печать), вкладки «Информация» (поля, правка
по кнопке) и «Работы и материалы» (таблица позиций, добавление через поиск `/nomenclature/search`, итог,
скидка, валовая прибыль — при праве). Справа — оплаты (принять оплату: касса, сумма, нал/безнал; возврат)
и история с полем комментария. «Выдать» = смена на первый статус группы closed (если долг — сначала окно оплаты).

### [ ] T-27c. Печать квитанции о приёме
`GET /orders/{id}/print/receipt` (бэкенд) возвращает HTML-страницу квитанции А4: реквизиты компании (Company),
локация (адрес, телефон), номер и дата заказа, клиент, устройство, SN, неисправность, комплектация, внешний вид,
ориентировочная цена, предоплата, мастер; место для подписей. На фронте кнопка «Печать» открывает её в новой вкладке
(`window.open`) и вызывает печать. Шаблон — Jinja2 в `backend/app/templates/receipt.html` (добавь jinja2 в requirements).

---

## Блок 5. Склад, продажи, финансы

### [R] T-28. Складские документы: поступление, перемещение, списание
Новый сервис `backend/app/services/stock_documents.py` (можно создавать) + роутер `/stock-documents`.
- Создание документа с позициями и сразу проведение: purchase → `stock.receive` по цене позиции;
  move → `stock.move` (store_id → to_store_id); cancellation → `stock.write_off`. total = сумма позиций.
- Поступление с оплатой: если передан {cash_register_id, amount, is_bank} — `money.create_transaction` со статьёй
  PURCHASE и counteragent_id поставщика; иначе долг поставщику: `money.charge_counteragent(vendor, -total)`
  (мы должны ему → его баланс растёт). Номер — `П-<n>`, `ПМ-<n>`, `С-<n>` (счётчик по типу, max+1).
- Удаление документа (права delete*DocumentAccess) — откат: обратные операции склада; запретить, если товар уже
  израсходован (write_off упадёт — пусть упадёт с понятной ошибкой).
- Права: purchaseAccess/createPurchaseDocumentAccess и т.д. (см. permissions.py, раздел «Склад»).
Тесты: остатки после каждого типа документа, откат при удалении, оплата поставщику.

### [x] T-29a. Инвентаризация (бэкенд). Остатки уже сделаны в T-29.
Ответ Claude на [!]: эндпоинты такие (роутер stock_documents.py, сервис stock_documents.py):
- `POST /stock-documents/inventory` — {location_id, store_id, note} → документ type=inventory, is_posted=False,
  позиции = все товары с ненулевым остатком склада: quantity_accounted = текущий остаток, quantity = он же, price = средняя цена.
- `PUT /stock-documents/{id}/positions` — {positions: [{nomenclature_id, quantity}]} — сохранить факт; новые товары
  (которых не было в учёте) добавить с quantity_accounted=0. Только для непроведённой инвентаризации.
- `POST /stock-documents/{id}/finish` — для каждой позиции разница = quantity − quantity_accounted:
  > 0 → stock.receive(разница, по средней цене), < 0 → stock.write_off(−разница); is_posted=True.
  Права: inventoryAccess / createInventoryDocumentAccess / changeInventoryDocumentAccess.
Тесты: излишек увеличивает остаток, недостача уменьшает, повторный finish → 400, правка проведённой → 400.
Фронтенд склада — отдельной задачей позже.

### [R] T-29. Остатки (бэкенд) — сделано, инвентаризация вынесена в T-29a.
- `GET /stock/remains?location_id=&store_id=&q=&only_positive=` — remainAccess; кол-во, средняя цена
  (при purchasePriceAccess), сумма.
- Инвентаризация: создать документ (заполнить позиции текущими остатками: quantity_accounted), ввести факт
  (quantity), `POST /stock-documents/{id}/finish` — излишки → receive по средней цене, недостача → write_off;
  is_posted=True.
- Фронтенд `/store/*`: подменю Остатки, Поступления, Перемещения, Списания, Инвентаризация; списки документов
  и форма документа (поиск товара, таблица позиций, итог).

### [R] T-30. Продажи (чеки, backend)
Новый сервис `backend/app/services/sales.py` + роутер `/sales` + страница `/sales`.
- Чек: локация, склад, позиции (товары — write_off, себестоимость в purchase_price; работы — без склада),
  скидка, клиент (необязательно), оплата одной или несколькими транзакциями статьи SALE. Номер `Ч-<n>`
  (Company.next_sale_number). Если оплачено меньше суммы и есть клиент — долг: `money.charge_counteragent`.
- Возврат по чеку: позиции и количество (не больше проданного − уже возвращённого), документ SALE_RETURN
  (receive обратно по purchase_price), транзакция SALE_RETURN.
- Страница: слева поиск товара/работы и корзина чека, справа итог и оплата; ниже — история чеков.
Тесты: продажа списывает остаток, оплата в кассу, возврат, нельзя вернуть больше проданного.

### [R] T-31. API финансов: журнал и операции
Роутер `/transactions`:
- `GET /transactions?cash_register_id=&location_id=&cash_item_id=&date_from=&date_to=&deleted=&page=` — transactionAccess.
- `POST /transactions` — ручной приход/расход по статье без системного type (operationCashRegisterAccess);
  дату в прошлом — только с cashDateAccess.
- `POST /transactions/move` — `money.move_money`.
- `DELETE /transactions/{id}` (changeTransactionAccess) — `money.delete_transaction`; транзакции, привязанные к
  заказу/чеку/документу, удалять только из их карточек (BusinessError).
- `POST /transactions/{id}/restore` — `money.restore_transaction`.
- `GET/POST/PUT /cash-items` — cashItemAccess; системные (type не null) нельзя менять и удалять.
Тесты: ручной расход меняет остаток, запрет удаления оплаты заказа отсюда, дата в прошлом без права → 403.

### [ ] T-32. Фронтенд финансов
`/finance/cashes` — карточки касс по локациям (нал/безнал), кнопки «Приход», «Расход», «Перемещение».
`/finance/transactions` — журнал с фильтрами, суммы зелёным/красным, удаление/восстановление по праву.
`/compendiums/cash-items` — статьи (системные — только просмотр).

---

## Блок 6. Перед боевым запуском (после ревью Claude)

### [ ] T-40. Alembic и PostgreSQL
- `docker-compose.yml` в корне с postgres:16 (порт 5432, том, пароль из .env).
- Alembic в `backend/alembic/` с env.py, читающим `settings.database_url` и `Base.metadata`;
  первая миграция autogenerate по текущим моделям против Postgres.
- В `app/main.py` убрать create_all (только если DATABASE_URL — postgres; для SQLite в разработке оставить).
- README: как поднять Postgres и применить миграции.
Проверка: `alembic upgrade head` на чистом Postgres + `python -m app.seed --demo` + тесты (тесты остаются на SQLite).
