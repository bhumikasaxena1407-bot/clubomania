import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import db from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deployment';
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

function auth(req,res,next){
 const token=(req.headers.authorization||'').replace('Bearer ','');
 try { req.user=jwt.verify(token,JWT_SECRET); next(); } catch { res.status(401).json({error:'Please log in to continue.'}); }
}
function allow(...roles){ return (req,res,next)=> roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission for this action.'}); }
function log(user,action,details=''){ db.prepare('INSERT INTO audit_logs(user_id,action,details) VALUES(?,?,?)').run(user,action,details); }
function notify(user,title,message,type='info'){ if(user) db.prepare('INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)').run(user,title,message,type); }
function canManageClub(user,clubId){ if(user.role==='admin') return true; const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(clubId); return !!club && user.role==='coordinator' && (club.coordinator_id===user.id || !!db.prepare('SELECT 1 FROM club_members WHERE club_id=? AND user_id=? AND member_role IN (\'coordinator\',\'core_team\')').get(clubId,user.id)); }

app.get('/api/health',(req,res)=>res.json({ok:true,name:'ClubHub API'}));
app.post('/api/auth/login',(req,res)=>{
 const {email,password}=req.body||{}; const user=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email||'');
 if(!user || !bcrypt.compareSync(password||'',user.password_hash)) return res.status(401).json({error:'Invalid email or password.'});
 const token=jwt.sign({id:user.id,role:user.role,name:user.name,email:user.email},JWT_SECRET,{expiresIn:'12h'});
 res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,roll_number:user.roll_number,department:user.department}});
});
app.get('/api/auth/me',auth,(req,res)=>{const u=db.prepare('SELECT id,name,email,role,roll_number,department,semester FROM users WHERE id=?').get(req.user.id);res.json({user:u});});

app.get('/api/dashboard',auth,(req,res)=>{
 const u=req.user; const stats={clubs:db.prepare("SELECT COUNT(*) n FROM clubs WHERE status='active'").get().n,events:db.prepare("SELECT COUNT(*) n FROM events WHERE status='published'").get().n,students:db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n,registrations:db.prepare('SELECT COUNT(*) n FROM registrations').get().n};
 let myEvents=[];
 if(u.role==='student') myEvents=db.prepare(`SELECT e.*,c.name club_name,r.status registration_status FROM registrations r JOIN events e ON e.id=r.event_id JOIN clubs c ON c.id=e.club_id WHERE r.user_id=? ORDER BY e.start_time`).all(u.id);
 if(u.role==='coordinator') myEvents=db.prepare('SELECT e.*,c.name club_name FROM events e JOIN clubs c ON c.id=e.club_id WHERE c.coordinator_id=? ORDER BY e.start_time').all(u.id);
 const recent=db.prepare(`SELECT a.*,u.name student_name,u.roll_number,e.title event_title,c.name club_name FROM attendance a JOIN users u ON u.id=a.user_id JOIN events e ON e.id=a.event_id JOIN clubs c ON c.id=e.club_id ${u.role==='mentor'?'WHERE u.mentor_id=?':u.role==='coordinator'?'WHERE c.coordinator_id=?':u.role==='student'?'WHERE a.user_id=?':''} ORDER BY a.marked_at DESC LIMIT 8`).all(...(['mentor','coordinator','student'].includes(u.role)?[u.id]:[]));
 res.json({stats,myEvents,recent});
});

app.get('/api/clubs',auth,(req,res)=>{
 const rows=db.prepare(`SELECT c.*,m.name mentor_name,co.name coordinator_name,(SELECT COUNT(*) FROM club_members cm WHERE cm.club_id=c.id) member_count FROM clubs c LEFT JOIN users m ON m.id=c.mentor_id LEFT JOIN users co ON co.id=c.coordinator_id ORDER BY c.name`).all();
 res.json({clubs:rows});
});
app.post('/api/clubs',auth,allow('admin'),(req,res)=>{
 const {name,category,description,mentor_id,coordinator_id}=req.body;
 if(!name) return res.status(400).json({error:'Club name is required.'});
 const r=db.prepare('INSERT INTO clubs(name,category,description,mentor_id,coordinator_id) VALUES(?,?,?,?,?)').run(name,category||'General',description||'',mentor_id||null,coordinator_id||null); log(req.user.id,'club_created',name); res.status(201).json({id:r.lastInsertRowid,message:'Club created.'});
});
app.put('/api/clubs/:id',auth,(req,res)=>{
 const id=Number(req.params.id); if(!canManageClub(req.user,id)) return res.status(403).json({error:'You cannot manage this club.'});
 const {name,category,description,mentor_id,coordinator_id,status}=req.body;
 db.prepare('UPDATE clubs SET name=COALESCE(?,name),category=COALESCE(?,category),description=COALESCE(?,description),mentor_id=COALESCE(?,mentor_id),coordinator_id=COALESCE(?,coordinator_id),status=COALESCE(?,status) WHERE id=?').run(name,category,description,mentor_id,coordinator_id,status,id); res.json({message:'Club updated.'});
});
app.get('/api/clubs/:id/members',auth,(req,res)=>res.json({members:db.prepare('SELECT u.id,u.name,u.email,u.roll_number,cm.member_role FROM club_members cm JOIN users u ON u.id=cm.user_id WHERE cm.club_id=? ORDER BY cm.member_role,u.name').all(req.params.id)}));
app.post('/api/clubs/:id/members',auth,(req,res)=>{const id=Number(req.params.id);if(!canManageClub(req.user,id))return res.status(403).json({error:'Not allowed.'});const {user_id,member_role='member'}=req.body;try{db.prepare('INSERT INTO club_members(club_id,user_id,member_role) VALUES(?,?,?)').run(id,user_id,member_role);res.json({message:'Member added.'});}catch{res.status(400).json({error:'Member already exists or user is invalid.'});}});

app.get('/api/events',auth,(req,res)=>{const rows=db.prepare(`SELECT e.*,c.name club_name,(SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) registration_count,${req.user.role==='student'?'(SELECT status FROM registrations r2 WHERE r2.event_id=e.id AND r2.user_id=? LIMIT 1)':'NULL'} registration_status FROM events e JOIN clubs c ON c.id=e.club_id WHERE e.status!='deleted' ORDER BY e.start_time`).all(...(req.user.role==='student'?[req.user.id]:[]));res.json({events:rows});});
app.post('/api/events',auth,allow('admin','coordinator'),(req,res)=>{
 const {club_id,title,description,venue,start_time,end_time,registration_deadline,capacity=100}=req.body;
 if(!club_id||!title||!start_time||!end_time)return res.status(400).json({error:'Club, title, start and end time are required.'});
 if(!canManageClub(req.user,Number(club_id)))return res.status(403).json({error:'You cannot create events for this club.'});
 if(new Date(end_time)<=new Date(start_time))return res.status(400).json({error:'End time must be after start time.'});
 const conflict=db.prepare(`SELECT e.id,e.title,c.name club_name FROM events e JOIN clubs c ON c.id=e.club_id WHERE e.status='published' AND e.venue=? AND e.start_time<? AND e.end_time>?`).get(venue||'',end_time,start_time);
 const r=db.prepare('INSERT INTO events(club_id,title,description,venue,start_time,end_time,registration_deadline,capacity,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(club_id,title,description||'',venue||'To be announced',start_time,end_time,registration_deadline||null,capacity,req.user.id);
 log(req.user.id,'event_created',title); res.status(201).json({id:r.lastInsertRowid,conflict:conflict||null,message:conflict?'Event created with a venue conflict warning.':'Event created.'});
});
app.put('/api/events/:id',auth,allow('admin','coordinator'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e)return res.status(404).json({error:'Event not found.'});if(!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});const {title,description,venue,start_time,end_time,capacity,status}=req.body;db.prepare('UPDATE events SET title=COALESCE(?,title),description=COALESCE(?,description),venue=COALESCE(?,venue),start_time=COALESCE(?,start_time),end_time=COALESCE(?,end_time),capacity=COALESCE(?,capacity),status=COALESCE(?,status) WHERE id=?').run(title,description,venue,start_time,end_time,capacity,status,e.id);res.json({message:'Event updated.'});});
app.post('/api/events/:id/register',auth,allow('student'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||e.status!=='published')return res.status(404).json({error:'Event not available.'});if(e.registration_deadline&&new Date(e.registration_deadline)<new Date())return res.status(400).json({error:'Registration deadline has passed.'});const n=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND status='registered'").get(e.id).n;if(n>=e.capacity)return res.status(400).json({error:'This event is full.'});try{db.prepare('INSERT INTO registrations(event_id,user_id) VALUES(?,?)').run(e.id,req.user.id);notify(req.user.id,'Registration confirmed',`You are registered for ${e.title}.`);res.status(201).json({message:'Registration successful.'});}catch{res.status(409).json({error:'You are already registered.'});}});
app.delete('/api/events/:id/register',auth,allow('student'),(req,res)=>{db.prepare('DELETE FROM registrations WHERE event_id=? AND user_id=?').run(req.params.id,req.user.id);res.json({message:'Registration cancelled.'});});
app.get('/api/events/:id/participants',auth,allow('admin','coordinator','mentor'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e)return res.status(404).json({error:'Not found.'});if(req.user.role==='coordinator'&&!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});res.json({participants:db.prepare(`SELECT u.id,u.name,u.roll_number,u.department,r.status registration_status,a.status attendance_status,a.verification_status FROM registrations r JOIN users u ON u.id=r.user_id LEFT JOIN attendance a ON a.event_id=r.event_id AND a.user_id=r.user_id AND a.session_id=(SELECT MAX(id) FROM attendance_sessions WHERE event_id=r.event_id) WHERE r.event_id=? ORDER BY u.name`).all(e.id)});});

app.post('/api/events/:id/attendance/start',auth,allow('admin','coordinator'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e)return res.status(404).json({error:'Event not found.'});if(!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});let s=db.prepare("SELECT * FROM attendance_sessions WHERE event_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(e.id);if(!s){const r=db.prepare('INSERT INTO attendance_sessions(event_id) VALUES(?)').run(e.id);s=db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(r.lastInsertRowid);}res.json({session:s});});
app.post('/api/events/:id/attendance/token',auth,allow('admin','coordinator'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});const s=db.prepare("SELECT * FROM attendance_sessions WHERE event_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(e.id);if(!s)return res.status(400).json({error:'Start an attendance session first.'});const token=crypto.randomBytes(24).toString('hex');const expires=Math.floor(Date.now()/1000)+25;db.prepare('INSERT INTO qr_tokens(session_id,token_hash,expires_at) VALUES(?,?,?)').run(s.id,crypto.createHash('sha256').update(token).digest('hex'),expires);const payload=Buffer.from(JSON.stringify({eventId:e.id,sessionId:s.id,token})).toString('base64url');res.json({payload,expiresAt:expires,seconds:25});});
app.post('/api/attendance/scan',auth,allow('student'),(req,res)=>{
 const {payload,deviceKey}=req.body||{};let decoded;try{decoded=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{return res.status(400).json({error:'QR code is not valid.'});}
 const {eventId,sessionId,token}=decoded;const s=db.prepare("SELECT * FROM attendance_sessions WHERE id=? AND event_id=? AND status='active'").get(sessionId,eventId);if(!s)return res.status(400).json({error:'Attendance session is not active.'});
 const hash=crypto.createHash('sha256').update(token||'').digest('hex');const q=db.prepare('SELECT * FROM qr_tokens WHERE session_id=? AND token_hash=?').get(sessionId,hash);if(!q||q.expires_at<Math.floor(Date.now()/1000))return res.status(400).json({error:'QR code has expired. Scan the current code.'});
 const reg=db.prepare("SELECT 1 FROM registrations WHERE event_id=? AND user_id=? AND status='registered'").get(eventId,req.user.id);if(!reg)return res.status(403).json({error:'You must be registered for this event.'});
 if(db.prepare('SELECT 1 FROM attendance WHERE session_id=? AND user_id=?').get(sessionId,req.user.id))return res.status(409).json({error:'Your attendance is already marked.'});
 const deviceReuse=deviceKey?db.prepare('SELECT 1 FROM attendance WHERE session_id=? AND device_key=?').get(sessionId,deviceKey):null;const status=deviceReuse?'needs_verification':'verified';
 db.prepare('INSERT INTO attendance(session_id,event_id,user_id,status,verification_status,device_key) VALUES(?,?,?,?,?,?)').run(sessionId,eventId,req.user.id,'present',status,deviceKey||null);
 const student=db.prepare('SELECT mentor_id FROM users WHERE id=?').get(req.user.id);if(student?.mentor_id)notify(student.mentor_id,status==='verified'?'Student attendance marked':'Attendance needs review',`${req.user.name} marked attendance for event #${eventId}. Status: ${status}.`,status==='verified'?'success':'warning');
 log(req.user.id,'attendance_marked',`event=${eventId}; verification=${status}`);res.json({message:status==='verified'?'Attendance marked successfully.':'Attendance recorded and flagged for review.',status});
});
app.post('/api/attendance/:id/review',auth,allow('mentor','admin'),(req,res)=>{const {decision,remarks=''}=req.body;if(!['verified','rejected'].includes(decision))return res.status(400).json({error:'Choose verified or rejected.'});const a=db.prepare('SELECT a.*,u.mentor_id FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.id=?').get(req.params.id);if(!a)return res.status(404).json({error:'Attendance not found.'});if(req.user.role==='mentor'&&a.mentor_id!==req.user.id)return res.status(403).json({error:'This student is not assigned to you.'});db.prepare('UPDATE attendance SET verification_status=? WHERE id=?').run(decision,a.id);notify(a.user_id,'Attendance review updated',`Your attendance review status is now ${decision}. ${remarks}`);log(req.user.id,'attendance_reviewed',`attendance=${a.id}; decision=${decision}; ${remarks}`);res.json({message:'Review saved.'});});
app.get('/api/attendance/review-queue',auth,allow('mentor','admin'),(req,res)=>{const rows=db.prepare(`SELECT a.*,u.name student_name,u.roll_number,e.title event_title,c.name club_name FROM attendance a JOIN users u ON u.id=a.user_id JOIN events e ON e.id=a.event_id JOIN clubs c ON c.id=e.club_id WHERE a.verification_status='needs_verification' ${req.user.role==='mentor'?'AND u.mentor_id=?':''} ORDER BY a.marked_at DESC`).all(...(req.user.role==='mentor'?[req.user.id]:[]));res.json({items:rows});});
app.post('/api/events/:id/attendance/close',auth,allow('admin','coordinator'),(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});db.prepare("UPDATE attendance_sessions SET status='closed',ends_at=CURRENT_TIMESTAMP WHERE event_id=? AND status='active'").run(e.id);res.json({message:'Attendance session closed.'});});

app.get('/api/announcements',auth,(req,res)=>res.json({announcements:db.prepare(`SELECT a.*,c.name club_name,u.name author FROM announcements a LEFT JOIN clubs c ON c.id=a.club_id LEFT JOIN users u ON u.id=a.created_by ORDER BY a.created_at DESC LIMIT 100`).all()}));
app.post('/api/announcements',auth,allow('admin','coordinator'),(req,res)=>{const {club_id,title,body}=req.body;if(!title||!body)return res.status(400).json({error:'Title and message are required.'});if(club_id&&!canManageClub(req.user,Number(club_id)))return res.status(403).json({error:'Not allowed.'});const r=db.prepare('INSERT INTO announcements(club_id,title,body,created_by) VALUES(?,?,?,?)').run(club_id||null,title,body,req.user.id);const users=club_id?db.prepare('SELECT user_id FROM club_members WHERE club_id=?').all(club_id):db.prepare("SELECT id user_id FROM users WHERE role='student'").all();const n=db.prepare('INSERT INTO notifications(user_id,title,message,type) VALUES(?,?,?,?)');for(const u of users)n.run(u.user_id,title,body,'announcement');res.status(201).json({id:r.lastInsertRowid,message:'Announcement published.'});});
app.get('/api/notifications',auth,(req,res)=>res.json({notifications:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id)}));
app.patch('/api/notifications/:id/read',auth,(req,res)=>{db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({message:'Marked as read.'});});

app.post('/api/certificates/issue',auth,allow('admin','coordinator'),(req,res)=>{const {event_id,user_id,certificate_type='participation'}=req.body;const e=db.prepare('SELECT * FROM events WHERE id=?').get(event_id);if(!e||!canManageClub(req.user,e.club_id))return res.status(403).json({error:'Not allowed.'});if(certificate_type==='participation'&&!db.prepare("SELECT 1 FROM attendance WHERE event_id=? AND user_id=? AND verification_status='verified'").get(event_id,user_id))return res.status(400).json({error:'Only students with verified attendance can receive participation certificates.'});const code='CH-'+crypto.randomBytes(5).toString('hex').toUpperCase();try{const r=db.prepare('INSERT INTO certificates(event_id,user_id,certificate_type,code) VALUES(?,?,?,?)').run(event_id,user_id,certificate_type,code);notify(user_id,'Your certificate is ready',`Your ${certificate_type} certificate is available in ClubHub.`,'success');res.status(201).json({id:r.lastInsertRowid,code});}catch{res.status(409).json({error:'This certificate has already been issued.'});}});
app.get('/api/certificates',auth,(req,res)=>{const rows=db.prepare(`SELECT ce.*,e.title event_title,c.name club_name,u.name student_name FROM certificates ce JOIN events e ON e.id=ce.event_id JOIN clubs c ON c.id=e.club_id JOIN users u ON u.id=ce.user_id WHERE ${req.user.role==='student'?'ce.user_id=?':'1=1'} ORDER BY ce.issued_at DESC`).all(...(req.user.role==='student'?[req.user.id]:[]));res.json({certificates:rows});});
app.get('/api/certificates/:id/pdf',auth,(req,res)=>{const c=db.prepare(`SELECT ce.*,e.title event_title,u.name student_name,cl.name club_name FROM certificates ce JOIN events e ON e.id=ce.event_id JOIN users u ON u.id=ce.user_id JOIN clubs cl ON cl.id=e.club_id WHERE ce.id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Certificate not found.'});if(req.user.role==='student'&&c.user_id!==req.user.id)return res.status(403).json({error:'Not allowed.'});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="ClubHub-${c.code}.pdf"`);const doc=new PDFDocument({size:'A4',layout:'landscape',margin:50});doc.pipe(res);doc.rect(25,25,792,545).lineWidth(3).stroke('#4f46e5');doc.rect(36,36,770,523).lineWidth(1).stroke('#c4b5fd');doc.fontSize(17).fillColor('#64748b').text('CLUBHUB  •  STUDENT COMMUNITY',0,95,{align:'center'});doc.moveDown(1);doc.fontSize(38).fillColor('#1e1b4b').text('Certificate of '+c.certificate_type,0,155,{align:'center'});doc.moveDown(1);doc.fontSize(17).fillColor('#475569').text('This certificate is proudly presented to',0,235,{align:'center'});doc.moveDown(.5);doc.fontSize(32).fillColor('#4338ca').text(c.student_name,0,275,{align:'center'});doc.moveDown(.6);doc.fontSize(16).fillColor('#475569').text(`For ${c.certificate_type} in ${c.event_title}`,0,335,{align:'center'});doc.fontSize(13).fillColor('#64748b').text(`${c.club_name}  •  Certificate ID: ${c.code}`,0,415,{align:'center'});doc.fontSize(12).text(`Issued ${new Date(c.issued_at).toLocaleDateString()}`,0,455,{align:'center'});doc.end();});
app.get('/api/admin/users',auth,allow('admin'),(req,res)=>res.json({users:db.prepare('SELECT id,name,email,role,roll_number,department,semester,mentor_id FROM users ORDER BY role,name').all()}));
app.post('/api/admin/import-students',auth,allow('admin'),(req,res)=>{const {students=[]}=req.body;let imported=0,skipped=0;const pass=bcrypt.hashSync('Welcome@123',10);const stmt=db.prepare('INSERT INTO users(name,email,password_hash,role,roll_number,department,semester,mentor_id) VALUES(?,?,?,\'student\',?,?,?,?)');const tx=db.transaction(rows=>{for(const s of rows){if(!s.name||!s.email||!s.roll_number){skipped++;continue;}try{stmt.run(s.name,s.email,pass,s.roll_number,s.department||'Undeclared',s.semester||null,s.mentor_id||null);imported++;}catch{skipped++;}}});tx(students);res.json({imported,skipped,temporaryPassword:'Welcome@123'});});
app.get('/api/admin/analytics',auth,allow('admin'),(req,res)=>{res.json({clubs:db.prepare('SELECT c.name,COUNT(DISTINCT e.id) events,COUNT(DISTINCT r.id) registrations FROM clubs c LEFT JOIN events e ON e.club_id=c.id LEFT JOIN registrations r ON r.event_id=e.id GROUP BY c.id ORDER BY registrations DESC').all(),participation:db.prepare('SELECT u.name,u.roll_number,COUNT(a.id) attendance_count FROM users u LEFT JOIN attendance a ON a.user_id=u.id WHERE u.role=\'student\' GROUP BY u.id ORDER BY attendance_count DESC LIMIT 10').all()});});
app.get('/api/admin/export-students',auth,allow('admin'),(req,res)=>{const rows=db.prepare("SELECT name,email,roll_number,department,semester FROM users WHERE role='student'").all();const keys=['name','email','roll_number','department','semester'];const csv=[keys.join(','),...rows.map(r=>keys.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(','))].join('\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename=clubhub-students.csv');res.send(csv);});

// Serve the built React app from the same origin in production.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
 if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
 res.sendFile(path.join(clientDist, 'index.html'), err => { if (err) next(err); });
});

app.listen(PORT, '0.0.0.0', () => console.log(`ClubHub server listening on port ${PORT}`));
