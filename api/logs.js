const { Pool } = require('pg');

let pool;
if (!pool) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for secure SSL handshake with AWS RDS
    }
  });
}

let tablesInitialized = false;

async function initializeDatabase(client) {
  if (tablesInitialized) return;
  
  const initSql = `
    -- 1. General Work Logs table
    CREATE TABLE IF NOT EXISTS work_logs (
        id VARCHAR(100) PRIMARY KEY,
        date DATE NOT NULL,
        shift VARCHAR(10) NOT NULL,
        is_number VARCHAR(50) NOT NULL,
        supervisor VARCHAR(150) NOT NULL,
        remarks TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Activities table
    CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        log_id VARCHAR(100) REFERENCES work_logs(id) ON DELETE CASCADE,
        type VARCHAR(150) NOT NULL,
        internal_count INTEGER DEFAULT 0,
        internal_ot NUMERIC(5,2) DEFAULT 0.00,
        extra_count INTEGER DEFAULT 0,
        extra_ot NUMERIC(5,2) DEFAULT 0.00,
        notes TEXT
    );

    -- 3. Machines table
    CREATE TABLE IF NOT EXISTS machines (
        id SERIAL PRIMARY KEY,
        log_id VARCHAR(100) REFERENCES work_logs(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        operator VARCHAR(255),
        start_time VARCHAR(10),
        end_time VARCHAR(10),
        break_minutes INTEGER DEFAULT 0,
        net_hours NUMERIC(5,2) DEFAULT 0.00,
        production TEXT
    );

    -- 4. Photos table
    CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        log_id VARCHAR(100) REFERENCES work_logs(id) ON DELETE CASCADE,
        photo_data TEXT NOT NULL,
        caption VARCHAR(255)
    );

    -- 5. Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_activities_log_id ON activities(log_id);
    CREATE INDEX IF NOT EXISTS idx_machines_log_id ON machines(log_id);
    CREATE INDEX IF NOT EXISTS idx_photos_log_id ON photos(log_id);
  `;
  
  await client.query(initSql);
  tablesInitialized = true;
}

module.exports = async (req, res) => {
  // CORS Configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: 'DATABASE_URL environment variable is not set. Please add it to your Vercel project settings.' });
  }

  const client = await pool.connect();
  try {
    // Ensure all tables exist on startup
    await initializeDatabase(client);

    // FETCH ALL LOGS (GET)
    if (req.method === 'GET') {
      const logsResult = await client.query('SELECT * FROM work_logs ORDER BY date DESC, created_at DESC');
      const logs = logsResult.rows;

      const [activitiesResult, machinesResult, photosResult] = await Promise.all([
        client.query('SELECT * FROM activities'),
        client.query('SELECT * FROM machines'),
        client.query('SELECT log_id, photo_data, caption FROM photos')
      ]);

      const activitiesGrouped = {};
      const machinesGrouped = {};
      const photosGrouped = {};

      activitiesResult.rows.forEach(row => {
        if (!activitiesGrouped[row.log_id]) activitiesGrouped[row.log_id] = [];
        activitiesGrouped[row.log_id].push({
          type: row.type,
          internalCount: Number(row.internal_count),
          internalOt: Number(row.internal_ot),
          extraCount: Number(row.extra_count),
          extraOt: Number(row.extra_ot),
          notes: row.notes
        });
      });

      machinesResult.rows.forEach(row => {
        if (!machinesGrouped[row.log_id]) machinesGrouped[row.log_id] = [];
        machinesGrouped[row.log_id].push({
          name: row.name,
          operator: row.operator,
          startTime: row.start_time,
          endTime: row.end_time,
          breakMinutes: Number(row.break_minutes),
          netHours: Number(row.net_hours),
          production: row.production
        });
      });

      photosResult.rows.forEach(row => {
        if (!photosGrouped[row.log_id]) photosGrouped[row.log_id] = [];
        photosGrouped[row.log_id].push({
          photoData: row.photo_data,
          caption: row.caption
        });
      });

      const fullLogs = logs.map(log => {
        let dateStr = log.date;
        if (log.date instanceof Date) {
          dateStr = log.date.toISOString().split('T')[0];
        }
        return {
          id: log.id,
          date: dateStr,
          shift: log.shift,
          isNumber: log.is_number,
          supervisor: log.supervisor,
          remarks: log.remarks,
          activities: activitiesGrouped[log.id] || [],
          machines: machinesGrouped[log.id] || [],
          photos: photosGrouped[log.id] || []
        };
      });

      return res.status(200).json(fullLogs);
    }

    // SAVE / UPDATE LOG (POST)
    if (req.method === 'POST') {
      const log = req.body;
      if (!log || !log.id || !log.date || !log.isNumber || !log.supervisor) {
        return res.status(400).json({ error: 'Missing required log fields' });
      }

      await client.query('BEGIN');

      const logUpsertQuery = `
        INSERT INTO work_logs (id, date, shift, is_number, supervisor, remarks)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE 
        SET date = EXCLUDED.date, shift = EXCLUDED.shift, is_number = EXCLUDED.is_number, 
            supervisor = EXCLUDED.supervisor, remarks = EXCLUDED.remarks;
      `;
      await client.query(logUpsertQuery, [
        log.id,
        log.date,
        log.shift,
        log.isNumber,
        log.supervisor,
        log.remarks || ''
      ]);

      // Remove previous records to overwrite cleanly on update
      await client.query('DELETE FROM activities WHERE log_id = $1', [log.id]);
      await client.query('DELETE FROM machines WHERE log_id = $1', [log.id]);
      await client.query('DELETE FROM photos WHERE log_id = $1', [log.id]);

      if (log.activities && log.activities.length > 0) {
        for (const act of log.activities) {
          const actInsertQuery = `
            INSERT INTO activities (log_id, type, internal_count, internal_ot, extra_count, extra_ot, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `;
          await client.query(actInsertQuery, [
            log.id,
            act.type,
            Number(act.internalCount) || 0,
            Number(act.internalOt) || 0.0,
            Number(act.extraCount) || 0,
            Number(act.extraOt) || 0.0,
            act.notes || ''
          ]);
        }
      }

      if (log.machines && log.machines.length > 0) {
        for (const mach of log.machines) {
          const machInsertQuery = `
            INSERT INTO machines (log_id, name, operator, start_time, end_time, break_minutes, net_hours, production)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
          await client.query(machInsertQuery, [
            log.id,
            mach.name,
            mach.operator || '',
            mach.startTime || '00:00',
            mach.endTime || '00:00',
            Number(mach.breakMinutes) || 0,
            Number(mach.netHours) || 0.0,
            mach.production || ''
          ]);
        }
      }

      if (log.photos && log.photos.length > 0) {
        for (const photo of log.photos) {
          const photoInsertQuery = `
            INSERT INTO photos (log_id, photo_data, caption)
            VALUES ($1, $2, $3)
          `;
          await client.query(photoInsertQuery, [
            log.id,
            photo.photoData,
            photo.caption || ''
          ]);
        }
      }

      await client.query('COMMIT');
      return res.status(200).json({ success: true, logId: log.id });
    }

    // DELETE LOG (DELETE)
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'Missing log ID' });
      }

      await client.query('DELETE FROM work_logs WHERE id = $1', [id]);
      return res.status(200).json({ success: true, deletedId: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    if (req.method === 'POST') {
      await client.query('ROLLBACK');
    }
    console.error('API execution error:', err);
    return res.status(500).json({ error: 'Database execution error: ' + err.message });
  } finally {
    client.release();
  }
};
