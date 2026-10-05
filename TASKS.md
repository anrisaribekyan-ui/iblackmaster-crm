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

### [R] T-06. API статусов заказа
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

### [R] T-09. Страница «Настройки»: локации, склады, кассы
`frontend/src/pages/settings/` — раздел с левым подменю: Локации, Статусы, Типы заказов, Сотрудники и роли.
В этой задаче — только «Локации»: список локаций (цветная метка, адрес), у каждой — склады и кассы
(название, нал/безнал, % банка). Добавление/правка через модальное окно (сделай общий компонент
`src/components/Modal.tsx`). Маршруты `/settings/locations` (по умолчанию для `/settings`).

### [R] T-09b. Настройки: статусы заказа
`/settings/statuses`: 5 колонок-групп, в каждой статусы цветными плашками. Клик — модальное окно правки
(название, текст для клиента, цвет, требует оплаты, комментарий, права ролей таблицей роль × [видит, ставит, меняет]).
Кнопка «+ статус» в каждой группе.

### [R] T-09c. Настройки: сотрудники и роли
`/settings/staff`: две вкладки. «Сотрудники» — таблица (имя, email, роль, локации, активен), добавить/изменить/
сменить пароль/отключить. «Роли» — список ролей; редактор роли: права чекбоксами, сгруппированными по разделам
(из `GET /permissions`), дочерние права с отступом и неактивны, пока не включён родитель; права-выборы — селектами.

### [R] T-09d. Настройки: типы заказов и редактор формы
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

### [R] T-14. Фронтенд справочников
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

### [R] T-26. Фронтенд: список заказов
`/orders` — как в LiveSklad (SPEC §2.4): сверху выбор локации, кнопка «Создать», поиск; вкладки-счётчики;
таблица; клик по строке → `/orders/:id`. Статус — цветная плашка. Срочные — красный значок.
Фильтры в выпадающей панели. Состояние вкладки и фильтров — в URL (query-параметры).

### [R] T-27. Фронтенд: создание заказа
`/orders/new` — выбрать тип заказа → форма из `GET /order-types/{id}/fields` (ряды и колонки по `place`).
Телефон: при вводе 10+ цифр искать клиента (`/counteragents/by-phone`) и подставлять. Марка/модель —
автодополнение (`/devices/suggest`), неисправность и комплектация — множественный выбор с подсказками
(`/problems`, `/complete-sets`) и возможностью вписать своё. После создания → карточка заказа.

### [R] T-27b. Фронтенд: карточка заказа
`/orders/:id`: шапка (номер, статус-выпадашка, кнопки Выдать / Печать), вкладки «Информация» (поля, правка
по кнопке) и «Работы и материалы» (таблица позиций, добавление через поиск `/nomenclature/search`, итог,
скидка, валовая прибыль — при праве). Справа — оплаты (принять оплату: касса, сумма, нал/безнал; возврат)
и история с полем комментария. «Выдать» = смена на первый статус группы closed (если долг — сначала окно оплаты).

### [R] T-27c. Печать квитанции о приёме
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

### [R] T-29a. Инвентаризация (бэкенд). Остатки уже сделаны в T-29.
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

### [R] T-32. Фронтенд финансов
`/finance/cashes` — карточки касс по локациям (нал/безнал), кнопки «Приход», «Расход», «Перемещение».
`/finance/transactions` — журнал с фильтрами, суммы зелёным/красным, удаление/восстановление по праву.
`/compendiums/cash-items` — статьи (системные — только просмотр).

---

### [R] T-33. Фронтенд склада — сделал Claude
`/store` с подменю: Остатки, Поступления, Перемещения, Списания, Инвентаризация (API уже есть: /stock/remains, /stock-documents).
- Остатки: выбор локации и склада, поиск, таблица (код, товар, кол-во, ср. цена — только при purchasePriceAccess, сумма), «только в наличии».
- Списки документов по типу: номер, дата, склад (откуда/куда), поставщик, сумма, оплачено. Кнопка «Создать».
- Форма документа: склад(ы), поставщик (для поступления, поиск по /counteragents?is_vendor=1), позиции через поиск
  /nomenclature/search (кол-во, цена), итог; для поступления — блок оплаты (касса, сумма, нал/безнал) необязательный.
- Инвентаризация: создать → таблица «Учёт / Факт / Отклонение», ввод факта, «Сохранить», «Закончить».
- Удаление документа — по праву, с подтверждением.
Даты — через `src/format.ts`. Пункт меню «Склад» уже ведёт на /store/remains.

### [R] T-34. Фронтенд продаж — сделал Claude
`/sales`: слева поиск товара/работы (/nomenclature/search по выбранной локации) и корзина чека (кол-во, цена, удалить),
справа: локация, склад, покупатель (необязательно, поиск по телефону через /counteragents/by-phone), скидка %, итог,
оплаты (можно несколько строк: касса, сумма, нал/безнал), кнопка «Пробить чек». Ниже — история чеков (номер, дата, сумма,
оплачено) с открытием чека и кнопкой «Возврат» (выбор позиций и количества, касса).
Если оплата меньше суммы без покупателя — показать ошибку бэкенда как есть.

---

## Блок 6. Перед боевым запуском (после ревью Claude)

### [R] T-40. Alembic и PostgreSQL — сделал Claude: миграции в backend/alembic, запуск на сервере — deploy/README.md.
Новую модель/поле теперь добавляет только Claude: `alembic revision --autogenerate`.
- `docker-compose.yml` в корне с postgres:16 (порт 5432, том, пароль из .env).
- Alembic в `backend/alembic/` с env.py, читающим `settings.database_url` и `Base.metadata`;
  первая миграция autogenerate по текущим моделям против Postgres.
- В `app/main.py` убрать create_all (только если DATABASE_URL — postgres; для SQLite в разработке оставить).
- README: как поднять Postgres и применить миграции.
Проверка: `alembic upgrade head` на чистом Postgres + `python -m app.seed --demo` + тесты (тесты остаются на SQLite).

---

# Этап 2 — работаем как в LiveSklad каждый день

Модели и миграции этого этапа уже сделал Claude (`app/models/task.py`, миграция `063225e2be35_tasks`).
Новые таблицы/поля НЕ добавляй — если без них никак, пометь `[?] Вопрос`.
Деньги — целые рубли: на фронте суммы через `money()` из `src/pages/shared.ts`, поля сумм `step="1"`.
Отчёты считают на бэкенде (SQL-агрегаты `func.sum/count`), фронт только показывает.

## Блок 7. Задачи

### [R] T-41. API задач
Файл `backend/app/api/tasks.py`, префикс `/tasks`, модель `Task`.
Видимость по `scope_of(me, "tasks")`: `none` → 403 на всё; `all` → все задачи (с учётом `location_ids(me)`, если у задачи есть location_id);
`own` → где `author_id == me.id` или `assignee_id == me.id`. Удалённые (`is_deleted`) не показывать.
- `GET /tasks?status=open|done|overdue|all&assignee_id=&order_id=&page=` — по 50, сортировка: открытые по `deadline` (NULL в конце), выполненные по `done_at desc`.
  overdue = не выполнена и `deadline < utcnow()`. В ответе: `{total, items: [{id, title, text, location_id, order_id, order_number, author_name, assignee_id, assignee_name, deadline, is_done, done_at, created_at}]}`.
- `POST /tasks` — право `createTaskAccess`. Поля: title (1..300, обяз.), text, assignee_id, deadline (UTC с поясом), order_id, location_id.
  Если указан order_id — проверь, что заказ существует и `check_location` по его локации; location_id тогда берётся из заказа.
- `PUT /tasks/{id}` — автор может всегда; чужую — только с `changeAllTaskAccess`.
- `POST /tasks/{id}/done` и `POST /tasks/{id}/reopen` — автор или исполнитель; иначе `changeAllTaskAccess`. done ставит `is_done, done_at=utcnow(), done_by_id`.
- `DELETE /tasks/{id}` — мягко (`is_deleted=True`); автор или `deleteAllTaskAccess`.
- Если задача привязана к заказу — при создании и выполнении пиши в историю заказа через `order_service.add_history(db, order, "comment", me, text="Задача: ...")` (посмотри сигнатуру в services/orders.py, сам файл не меняй).
Тесты `backend/tests/test_tasks.py`: создание, список own vs all, просрочка, done/reopen, 403 без createTaskAccess, чужую нельзя править без changeAllTaskAccess.

### [R] T-42. Страница «Задачи»
`/tasks` (заменить заглушку в App.tsx). Вкладки: «Открытые», «Просроченные», «Выполненные», «Все». Фильтр «Исполнитель» (список из `/staff`).
Строка: чекбокс «выполнено» (done/reopen), заголовок, исполнитель, срок (красным `text-danger`, если просрочено), ссылка на заказ `/orders/{id}` если есть.
Кнопка «Новая задача» (если `can('createTaskAccess')`) → модалка: заголовок, текст, исполнитель, срок (`datetime-local` → `localInputToIso`), заказ (необязательно, номер вводить не нужно — только из карточки заказа, см. T-43).
Клик по строке — модалка редактирования; «Удалить» с подтверждением.

### [R] T-43. Задачи в карточке заказа
В `OrderDetailPage.tsx` в правой колонке (над «Историей») блок «Задачи»: список `GET /tasks?order_id=...&status=all`, чекбокс done/reopen,
кнопка «+ Задача» (createTaskAccess) — та же форма, order_id подставляется. Вынеси форму задачи в `src/components/TaskForm.tsx`, используй её и в T-42.

## Блок 8. Главная

### [R] T-44. API главной
Файл `backend/app/api/dashboard.py`, `GET /dashboard?location_id=&date_from=&date_to=` (даты — UTC ISO; по умолчанию — сегодня по Москве, посчитай границы суток в Europe/Moscow и переведи в UTC).
Локации: если location_id указан — `check_location`, иначе все из `location_ids(me)`. Каждый блок отдаётся только при праве, иначе `null`:
- `orders`: всегда — {created: заказов создано за период, in_work: сейчас не в группе closed, ready: в группе ready (см. StatusGroup), closed: выдано за период (`closed_at` в периоде)}.
  `closed` — только при `dashboardOrderClosedAccess`, иначе null. Если нет `dashboardOrderPeriodAccess` — период принудительно «сегодня».
- `overdue` (dashboardDeadlineAccess): до 20 заказов, где deadline < сейчас и статус не closed: [{id, number, deadline, status_name, status_color, master_name}].
- `finance` (dashboardFinanceAccess): {income: сумма приходов по транзакциям с order_id или sale_id за период (без `is_deleted`), expense: сумма расходов, cash_registers: [{id, name, cash_balance, bank_balance}]} — только кассы доступных локаций.
- `how_know` (dashboardHowKnowAccess): [{name, count}] — заказы за период по `how_know_id`, по убыванию.
- `masters`: [{employee_id, name, orders_in_work}] — у кого сколько незакрытых заказов (`master_id`).
Тесты: пустой день, заказ попадает в created, просрочка, блок finance = null без права.

### [R] T-45. Страница «Главная»
`/` (заменить заглушку). Сверху: выбор локации (Все / каждая), период: Сегодня / Вчера / 7 дней / Месяц / свой (две даты) — период показывать, только если блок orders пришёл с правом периода (если нет права — без выбора).
Плитки: Создано, В работе, Готово, Выдано (если не null). Ниже карточки: «Просроченные» (список со ссылками на заказы), «Кассы» (остатки нал/безнал, итог), «Приход / расход за период», «Источники рекламы» (горизонтальные полосы div-ами по доле, без библиотек), «Загрузка мастеров».
Каждая карточка рисуется, только если её данные не null.

## Блок 9. Аналитика

### [R] T-46. API отчётов
Файл `backend/app/api/reports.py`, префикс `/reports`, все эндпоинты — право `reportAccess`. Параметры у всех: `date_from, date_to` (UTC ISO, обяз.), `location_id` (необяз., `check_location`; без него — `location_ids(me)`).
- `GET /reports/orders?group_by=master|manager|order_type|status|how_know|day` — по заказам, ВЫДАННЫМ в периоде (`closed_at`): [{key, name, count, revenue: sum(total_price), cost: sum(total_purchase), profit: revenue-cost}].
  `cost` и `profit` отдавать только при `marginPriceAccess`, иначе null. day — ключ «YYYY-MM-DD» по Москве.
- `GET /reports/works?group_by=performer|nomenclature` — по позициям выданных заказов: [{key, name, quantity, revenue: sum(sold_price*quantity), cost, profit}] (то же правило для cost/profit). Работы и запчасти раздельно: параметр `is_work=true|false`.
- `GET /reports/sales?group_by=seller|day|nomenclature` — по чекам за период (без удалённых): [{key, name, count, revenue, cost, profit}].
- `GET /reports/cashflow?group_by=cash_item|cash_register|day` — транзакции за период: [{key, name, income, expense}].
- `GET /reports/stock-value` — по складам доступных локаций: [{store_id, store_name, positions, quantity, value: sum(quantity*avg_purchase_price)}], value только при `purchasePriceAccess`.
Везде в конце строка не нужна — итоги считает фронт. Тесты: по одному на каждый эндпоинт + 403 без reportAccess + cost=null без marginPriceAccess.

### [R] T-47. Страница «Аналитика»
`/analytics` (заменить заглушку `analytics/*`). Вкладки: Заказы, Работы и запчасти, Продажи, Деньги, Склад. Общая панель: период (как на главной) + локация.
Каждая вкладка: селект «Группировать по», таблица с колонками из ответа и строкой «Итого» внизу, кнопка «Скачать CSV» (генерировать на фронте: `;` разделитель, BOM `﻿` для Excel, имя файла `отчёт-заказы-2026-10-01-2026-10-31.csv`).
Если cost/profit null — колонки не показывать. Если нет `can('reportAccess')` — текст «Нет доступа к отчётам».

## Блок 10. Клиенты и печать

### [R] T-48. История клиента
`GET /counteragents/{id}/history` в `backend/app/api/counteragents.py` (право как у `GET /counteragents/{id}`):
{orders: [{id, number, created_at, status_name, status_color, device (тип+бренд+модель), total_price, paid}], sales: [{id, number, date, total_price}], transactions: [{id, date, amount, is_income, cash_item_name, note}]} — последние 100 каждого вида, новые сверху; заказы с учётом `scope_of(me, "orders")` так же, как в списке заказов.
Фронт: в карточке контрагента (`CounteragentsPage.tsx`) вкладки «Заказы», «Продажи», «Платежи»; номер заказа — ссылка. Тест на эндпоинт.

### [R] T-49. Печать: акт выдачи и товарный чек
Посмотри, как сделана `printReceipt` в `OrderDetailPage.tsx`, и сделай так же (окно печати с HTML, без библиотек):
- Вынеси общее в `src/print.ts`: `openPrint(title, bodyHtml)` + функция `escapeHtml`. Существующую квитанцию переведи на неё без изменения вида.
- «Акт выполненных работ» в карточке заказа (кнопка «Печать» становится меню: Квитанция о приёме / Акт выдачи): реквизиты локации (название, адрес, телефоны), номер заказа, клиент, устройство, SN/IMEI, таблица позиций (название, кол-во, цена, сумма, гарантия дней), итог, оплачено, строка «Претензий к качеству и срокам не имею», подписи клиента и мастера, дата.
- «Товарный чек» в карточке чека на `/sales`: номер, дата, позиции, итог, продавец.

## Блок 11. Удобство

### [R] T-50. Быстрый поиск в шапке
В `src/components/Layout.tsx` поле поиска в шапке: Enter → если похоже на номер заказа (буква + цифры, например A15843) — `GET /orders?q=...` и при единственном результате сразу открыть заказ; иначе перейти на `/orders?q=...` (страница заказов должна подхватить параметр `q` из URL в фильтр — доработай OrdersPage).
Проверь, что `GET /orders` уже ищет по номеру, телефону, имени клиента и SN; если нет какого-то поля — добавь в фильтр роутера `backend/app/api/orders.py` (только фильтр, без изменения остальной логики) и тест.

### [R] T-51. Экспорт в CSV
Кнопка «Скачать CSV» на страницах: Заказы (текущий фильтр, все страницы — запрашивай постранично до конца), Финансы → Транзакции, Склад → Остатки, Контрагенты.
Общая функция `downloadCsv(filename, headers, rows)` в `src/csv.ts` (тот же формат, что в T-47 — используй её и там).

## Блок 12. Зарплата (расчёт и API сделал Claude — `services/salary.py`, `api/salary.py`)

Как в LiveSklad «Финансы → Зарплата». Бэкенд готов, задачи только на фронтенд.
Эндпоинты (все под `/api/salary`): `GET /summary?year&month&location_id`, `GET /employees/{id}/months`,
`GET /employees/{id}/events?year&month`, `GET /employees/{id}/payouts`, `POST /events` (бонус/штраф),
`DELETE /events/{id}` (только ручные), `POST /payouts`, `GET/POST/PUT/DELETE /rules`, `POST /recalc`, `GET /kinds`.
Смотри `backend/app/api/salary.py` и тесты `backend/tests/test_salary_api.py` — там видно форму запросов и ответов.
`backend/app/services/salary.py` и `backend/app/api/salary.py` НЕ менять — если чего-то не хватает, `[?] Вопрос`.

### [x] T-52. Страница «Зарплата»
Вкладка «Зарплата» в `FinanceLayout` (`/finance/salary`, маршрут в App.tsx).
- Сверху: выбор месяца (‹ Октябрь 2026 ›) и локации (Все / каждая).
- Таблица `GET /salary/summary`: Сотрудник, Начислено (`total`), Выплачено, К выплате (красным, если < 0). Строка «Итого».
- Клик по сотруднику → `/finance/salary/{employeeId}` (T-53).
Нет доступа (403) — текст «Нет доступа к зарплате».

### [x] T-53. Карточка зарплаты сотрудника
`/finance/salary/{employeeId}`, вкладки:
- «Начисления»: `GET /employees/{id}/months` — таблица Период, Оклад, Начисления, Бонусы, Штрафы, Итого, Выплачено, К выплате, строка «Итого».
  Клик по месяцу раскрывает расшифровку `GET /employees/{id}/events?year&month`: дата, за что (`kind_title`), заказ/чек (ссылка на заказ),
  база и процент из `details` (`base_value`, `value`), сумма. У ручных (`is_manual`) — кнопка «Удалить» (право `changeSalaryAccess`, с подтверждением).
- «Выплаты»: `GET /employees/{id}/payouts`.
- Кнопки сверху: «Бонус», «Штраф» (право `bonusPenaltyRevenueSalaryAccess`; модалка: сумма, дата, локация, комментарий → `POST /events`),
  «Выплатить» (право `cashSalaryAccess`; модалка: касса из `/cash-registers`, сумма — по умолчанию «к выплате» текущего месяца, нал/безнал, комментарий → `POST /payouts`).

### [x] T-54. Настройки зарплаты сотрудника
Вкладка «Настройки» в карточке из T-53 (видна при `salarySettingAccess`), как в LiveSklad:
- Сетка: строки — виды начислений (из `GET /salary/kinds`, кроме bonus/penalty/money/revenue), колонки — «Общее», «Для локации», «По типу заказа», «Локация + тип».
  В ячейке — карточки правил (`GET /rules?employee_id`) с кратким текстом («50% от прибыли», «при Готов»). «+ Добавить начисление».
- Модалка правила: вид, показатель (Валовая прибыль = margin / Стоимость = summ), тип заказа (не для продаж), локация,
  «Начислять, когда заказ»: Готов = finish / Выдан = close (не для продаж), «Скидка за счёт»: Сотрудника = worker / Компании = company,
  для продаж и «за новый заказ» — галочки «Работы»/«Запчасти» (`options.isWork/isProduct`),
  ступени: строки «Начислять [число] [₽ | %] если показатель ≥ [число]» + «Добавить правило» (→ `steps`, `value_type`),
  «Не более» (`max_amount`), «Вычитать отрицательную прибыль», «Не удалять зарплату при возврате» (только продажи). Сохранить / Удалить.
- Кнопка «Пересчитать зарплату» → выбор месяца → `POST /recalc` → сообщение «Пересчитано документов: N».
