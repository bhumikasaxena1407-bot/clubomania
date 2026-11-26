import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database(process.env.CLUBHUB_DB_PATH || 'clubhub.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','coordinator','mentor','admin')),
 roll_number TEXT UNIQUE, department TEXT, semester TEXT, mentor_id INTEGER REFERENCES users(id),
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clubs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT, description TEXT,
 logo TEXT, status TEXT DEFAULT 'active', mentor_id INTEGER REFERENCES users(id), coordinator_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS club_members (
 id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL REFERENCES clubs(id), user_id INTEGER NOT NULL REFERENCES users(id),
 member_role TEXT DEFAULT 'member', UNIQUE(club_id,user_id)
);
CREATE TABLE IF NOT EXISTS venues (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, capacity INTEGER DEFAULT 100);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL REFERENCES clubs(id), title TEXT NOT NULL, description TEXT,
 venue_id INTEGER REFERENCES venues(id), venue TEXT, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
 registration_deadline TEXT, capacity INTEGER DEFAULT 100, status TEXT DEFAULT 'published', created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id), user_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT DEFAULT 'registered', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS attendance_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id), starts_at TEXT DEFAULT CURRENT_TIMESTAMP,
 ends_at TEXT, status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS qr_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES attendance_sessions(id), token_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS attendance (
 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES attendance_sessions(id), event_id INTEGER NOT NULL REFERENCES events(id),
 user_id INTEGER NOT NULL REFERENCES users(id), status TEXT DEFAULT 'present', verification_status TEXT DEFAULT 'verified', marked_at TEXT DEFAULT CURRENT_TIMESTAMP,
 device_key TEXT, UNIQUE(session_id,user_id)
);
CREATE TABLE IF NOT EXISTS announcements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER REFERENCES clubs(id), title TEXT NOT NULL, body TEXT NOT NULL,
 created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, message TEXT NOT NULL,
 type TEXT DEFAULT 'info', is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS certificates (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id), user_id INTEGER NOT NULL REFERENCES users(id),
 certificate_type TEXT NOT NULL, code TEXT NOT NULL UNIQUE, issued_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,user_id,certificate_type)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!count) {
 const pass = bcrypt.hashSync('clubhub123', 10);
 const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,roll_number,department,semester) VALUES(?,?,?,?,?,?,?)');
 const admin = addUser.run('ClubHub Admin','admin@clubhub.edu',pass,'admin',null,'Administration',null).lastInsertRowid;
 const mentor = addUser.run('Dr. Ananya Sharma','mentor@clubhub.edu',pass,'mentor',null,'Computer Science',null).lastInsertRowid;
 const coord = addUser.run('Aarav Mehta','coordinator@clubhub.edu',pass,'coordinator','IT2024001','Information Technology','5').lastInsertRowid;
 const student = addUser.run('Riya Verma','student@clubhub.edu',pass,'student','IT2024052','Information Technology','3').lastInsertRowid;
 db.prepare('UPDATE users SET mentor_id=? WHERE id IN (?,?)').run(mentor,coord,student);
 const club = db.prepare('INSERT INTO clubs(name,category,description,mentor_id,coordinator_id) VALUES(?,?,?,?,?)').run('CodeCraft Club','Technology','A community for builders, problem-solvers and curious developers. Learn together, build projects and take part in coding events.',mentor,coord).lastInsertRowid;
 db.prepare('INSERT INTO clubs(name,category,description,mentor_id,coordinator_id) VALUES(?,?,?,?,?)').run('Photosphere','Creative Arts','The campus photography community for visual storytelling, photo walks and creative workshops.',mentor,coord);
 db.prepare('INSERT INTO clubs(name,category,description,mentor_id,coordinator_id) VALUES(?,?,?,?,?)').run('Nritya Club','Performing Arts','A space for dancers to collaborate, perform and celebrate movement.',mentor,coord);
 db.prepare('INSERT INTO club_members(club_id,user_id,member_role) VALUES(?,?,?)').run(club,coord,'coordinator');
 db.prepare('INSERT INTO club_members(club_id,user_id,member_role) VALUES(?,?,?)').run(club,student,'member');
 db.prepare('INSERT INTO venues(name,capacity) VALUES(?,?)').run('Seminar Hall',200);
 db.prepare('INSERT INTO venues(name,capacity) VALUES(?,?)').run('Auditorium',500);
 db.prepare('INSERT INTO events(club_id,title,description,venue,start_time,end_time,registration_deadline,capacity,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(club,'Build-a-thon 2026','A one-day sprint to turn ideas into useful prototypes.','Seminar Hall',new Date(Date.now()+86400000*5).toISOString(),new Date(Date.now()+86400000*5+4*3600000).toISOString(),new Date(Date.now()+86400000*4).toISOString(),120,coord);
 db.prepare('INSERT INTO announcements(club_id,title,body,created_by) VALUES(?,?,?,?)').run(club,'Welcome to ClubHub','Explore clubs, register for events and keep your campus journey organised.',coord);
}
export default db;
