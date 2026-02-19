/**
 * MTGDoku — Database layer for daily puzzles.
 *
 * Stores one puzzle per calendar day. Each puzzle is 3 row criteria + 3 column
 * criteria (e.g. "Blue Cards", "Creatures", "Mana Value 3"). The criteria
 * are saved as JSON strings in SQLite.
 *
 * File: mtgdoku.db (created in the same folder as this file).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path to the SQLite file (e.g. project_root/mtgdoku.db)
const DB_PATH = path.join(__dirname, 'mtgdoku.db');
let db = null;

/**
 * Opens the database and creates the puzzles table if it doesn't exist.
 * Safe to call multiple times; after the first call, the same connection is reused.
 */
function init() {
    if (db) return db;

    // Ensure the folder for the DB file exists (e.g. if __dirname is the only path)
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);

    // One row per date. row_criteria and col_criteria are JSON strings.
    db.exec(`
        CREATE TABLE IF NOT EXISTS puzzles (
            date TEXT PRIMARY KEY,
            row_criteria TEXT NOT NULL,
            col_criteria TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    return db;
}

/**
 * Loads the puzzle for a given date from the database.
 * @param {string} dateStr - Date in YYYY-MM-DD (e.g. "2026-02-18").
 * @returns {{ rowCriteria: Array, colCriteria: Array } | null} The puzzle, or null if that date has no row.
 */
function getPuzzle(dateStr) {
    init();
    const row = db.prepare(
        'SELECT row_criteria, col_criteria FROM puzzles WHERE date = ?'
    ).get(dateStr);

    if (!row) return null;

    // Stored as JSON strings; parse back to arrays of { name, code } objects.
    return {
        rowCriteria: JSON.parse(row.row_criteria),
        colCriteria: JSON.parse(row.col_criteria)
    };
}

/**
 * Saves a puzzle for a given date. If that date already has a row, it is updated.
 * @param {string} dateStr - Date in YYYY-MM-DD.
 * @param {Array} rowCriteria - Array of 3 objects: { name: string, code: string }.
 * @param {Array} colCriteria - Array of 3 objects: { name: string, code: string }.
 */
function savePuzzle(dateStr, rowCriteria, colCriteria) {
    init();
    const stmt = db.prepare(`
        INSERT INTO puzzles (date, row_criteria, col_criteria)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            row_criteria = excluded.row_criteria,
            col_criteria = excluded.col_criteria
    `);
    stmt.run(dateStr, JSON.stringify(rowCriteria), JSON.stringify(colCriteria));
}

/**
 * Returns today's date in YYYY-MM-DD using UTC (e.g. for server-side "today").
 */
function todayUTC() {
    const d = new Date();
    return d.toISOString().slice(0, 10);  // "2026-02-18"
}

module.exports = {
    init,
    getPuzzle,
    savePuzzle,
    todayUTC
};
