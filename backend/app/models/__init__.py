"""Все модели импортируются здесь, чтобы Base.metadata знала о каждой таблице."""

from app.models.board import Board, BoardColumn, BoardSpace, Card, CardComment
from app.models.catalog import (
    Brand,
    CompleteSet,
    DeviceModel,
    DeviceType,
    Measure,
    Nomenclature,
    NomenclatureGroup,
    NomenclaturePrice,
    PriceType,
    Problem,
    StockBalance,
)
from app.models.company import CashRegister, Company, Location, Store
from app.models.counteragent import Counteragent, CounteragentType, HowKnow
from app.models.finance import CashItem, CashItemType, Transaction
from app.models.notification import Notification, NotificationState, NotificationTemplate
from app.models.order import (
    HISTORY_TYPES,
    STATUS_GROUP_TITLES,
    FieldDataType,
    FormField,
    Order,
    OrderFile,
    OrderHistory,
    OrderPosition,
    OrderStatus,
    OrderType,
    StatusGroup,
)
from app.models.salary import AccrualKind, SalaryEvent, SalaryRule
from app.models.staff import Employee, Role, employee_location
from app.models.task import Task
from app.models.stock import (
    STOCK_DOC_TITLES,
    Sale,
    SalePosition,
    StockDocType,
    StockDocument,
    StockDocumentPosition,
)

__all__ = [name for name in dir() if not name.startswith("_")]
