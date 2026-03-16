import sqlite3
import logging
from pathlib import Path
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import calendar

logger = logging.getLogger(__name__)

# Resolve path to the data folder
DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DATA_DIR / "history.db"

def init_db():
    try:
        if not DATA_DIR.exists():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL DEFAULT '',
                work_date TEXT NOT NULL,
                hours REAL NOT NULL,
                template TEXT,
                tasks TEXT,
                schedule TEXT,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Migration: add username column to existing databases
        cursor.execute("PRAGMA table_info(entries)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'username' not in cols:
            cursor.execute("ALTER TABLE entries ADD COLUMN username TEXT NOT NULL DEFAULT ''")
        conn.commit()
        conn.close()
        logger.info(f"Database initialized at {DB_PATH}")
    except sqlite3.OperationalError as e:
        logger.error(f"🚨 CRITICAL ERROR: Fallo al abrir SQLite en {DB_PATH}. "
                     f"Asegúrate de que el Dataset de TrueNAS tenga permisos de ESCRITURA (ACL) "
                     f"para el usuario de la App. Detalle interno: {e}")


def add_entry(username: str, work_date: str, hours: float, template: str, tasks: str, schedule: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO entries (username, work_date, hours, template, tasks, schedule)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (username, work_date, hours, template, tasks, schedule))
    conn.commit()
    conn.close()

def _get_period_bounds(target_date: date):
    """
    Returns the start and end dates for a period and its label.
    Period starts on the 21st of the previous month and ends on the 20th of the current month.
    If target_date is between 1st and 20th, it belongs to the current month's period.
    If target_date is between 21st and end of month, it belongs to the NEXT month's period.
    """
    if target_date.day <= 20:
        period_month = target_date.month
        period_year = target_date.year
    else:
        next_month_date = target_date + relativedelta(months=1)
        period_month = next_month_date.month
        period_year = next_month_date.year

    # Calculate boundaries
    end_date = date(period_year, period_month, 20)
    start_date = end_date - relativedelta(months=1) + relativedelta(days=1)
    
    month_name = calendar.month_name[period_month] # In English, but we can localize it in frontend or here
    months_es = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    label = f"Periodo {months_es[period_month]} {period_year}"
    
    period_id = f"{period_year}-{period_month:02d}"
    
    return period_id, label, start_date.isoformat(), end_date.isoformat()

def get_periods(username: str = ''):
    """
    Groups all entries into custom periods (21st to 20th) and calculates sums.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT work_date, hours FROM entries WHERE username = ?", (username,))
    rows = cursor.fetchall()
    conn.close()

    periods_data = {}
    
    for row in rows:
        d = date.fromisoformat(row['work_date'])
        period_id, label, start_iso, end_iso = _get_period_bounds(d)
        
        if period_id not in periods_data:
            periods_data[period_id] = {
                "id": period_id,
                "label": label,
                "start_date": start_iso,
                "end_date": end_iso,
                "total_hours": 0
            }
        periods_data[period_id]["total_hours"] += row['hours']

    # Sort periods descending
    sorted_periods = sorted(periods_data.values(), key=lambda x: x["id"], reverse=True)
    return sorted_periods

def get_entries_by_period(period_id: str, username: str = ''):
    """
    Fetches detailed entries for a given period ID (YYYY-MM).
    """
    year, month = map(int, period_id.split('-'))
    # Dummy date on the 10th of the month forces the calculation to yield that specific period
    target = date(year, month, 10)
    _, _, start_iso, end_iso = _get_period_bounds(target)
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, work_date, hours, template, tasks, schedule, submitted_at
        FROM entries
        WHERE work_date >= ? AND work_date <= ? AND username = ?
        ORDER BY work_date DESC
    """, (start_iso, end_iso, username))
    
    entries = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return entries
