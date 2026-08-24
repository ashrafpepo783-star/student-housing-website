require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("housing.db");
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true, sameSite:"lax", secure:false, maxAge:1000*60*60*24}
}));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL,
 password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS apartments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL, area TEXT NOT NULL, address TEXT,
 description TEXT, video TEXT, status TEXT DEFAULT 'available',
 single_price REAL DEFAULT 0, double_price REAL DEFAULT 0, triple_price REAL DEFAULT 0,
 single_beds INTEGER DEFAULT 0, double_beds INTEGER DEFAULT 0, triple_beds INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS apartment_images(
 id INTEGER PRIMARY KEY AUTOINCREMENT, apartment_id INTEGER NOT NULL, file TEXT NOT NULL,
 FOREIGN KEY(apartment_id) REFERENCES apartments(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bookings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL, apartment_id INTEGER NOT NULL,
 bed_type TEXT NOT NULL, monthly_rent REAL NOT NULL, deposit REAL NOT NULL,
 commission REAL NOT NULL, total REAL NOT NULL,
 receipt TEXT NOT NULL, status TEXT DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(apartment_id) REFERENCES apartments(id)
);
`);

const adminEmail = process.env.ADMIN_EMAIL || ("ashragpepo783@gmail.com");
const adminPassword = process.env.ADMIN_PASSWORD || ("k7l03250ashrag");
if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(name,email,phone,password,role) VALUES(?,?,?,?,?)")
    .run("Administrator", adminEmail, "01000000000", hash, "admin");
}

const storage = multer.diskStorage({
 destination: uploadDir,
 filename: (req,file,cb) => {
   const ext = path.extname(file.originalname);
   cb(null, Date.now()+"-"+Math.random().toString(36).slice(2)+ext);
 }
});
const upload = multer({
 storage,
 limits:{fileSize:50*1024*1024},
 fileFilter:(req,file,cb)=>{
   const ok = /image\/|video\/|application\/pdf/.test(file.mimetype);
   cb(ok?null:new Error("Only images, video and PDF are allowed"), ok);
 }
});

function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:"Login required"}); next(); }
function admin(req,res,next){ if(!req.session.user || req.session.user.role!=="admin") return res.status(403).json({error:"Admin only"}); next(); }

function calculate(rent){
  const deposit = Number(rent);
  const commission = Number(rent) * Number(process.env.COMMISSION_RATE || 0.25);
  const total = Number(rent) + deposit + commission;
  return {deposit, commission, total};
}

async function sendBookingEmail(booking){
  if(!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    host:process.env.SMTP_HOST || "smtp.gmail.com",
    port:Number(process.env.SMTP_PORT || 465),
    secure:String(process.env.SMTP_SECURE||"true")==="true",
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}
  });
  await transporter.sendMail({
    from:process.env.SMTP_USER,
    to:adminEmail,
    subject:`طلب حجز جديد #${booking.id}`,
    text:`طلب حجز جديد
الطالب: ${booking.student_name}
الهاتف: ${booking.phone}
الشقة: ${booking.apartment_title}
نوع السرير: ${booking.bed_type}
الإيجار: ${booking.monthly_rent} جنيه
التأمين: ${booking.deposit} جنيه
العمولة: ${booking.commission} جنيه
الإجمالي: ${booking.total} جنيه
الحالة: ${booking.status}`
  });
}

app.post("/api/register",(req,res)=>{
 const {name,email,phone,password}=req.body;
 if(!name||!email||!phone||!password) return res.status(400).json({error:"All fields are required"});
 try{
   const hash=bcrypt.hashSync(password,12);
   const info=db.prepare("INSERT INTO users(name,email,phone,password) VALUES(?,?,?,?)").run(name,email,phone,hash);
   req.session.user={id:info.lastInsertRowid,name,email,phone,role:"student"};
   res.json({ok:true,user:req.session.user});
 }catch(e){ res.status(400).json({error:"Email already exists"}); }
});

app.post("/api/login",(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
 if(!u || !bcrypt.compareSync(req.body.password,u.password)) return res.status(401).json({error:"Invalid email or password"});
 req.session.user={id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role};
 res.json({ok:true,user:req.session.user});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));

app.get("/api/apartments",(req,res)=>{
 const rows=db.prepare("SELECT * FROM apartments ORDER BY id DESC").all();
 for(const a of rows){
   a.images=db.prepare("SELECT file FROM apartment_images WHERE apartment_id=?").all(a.id).map(x=>"/uploads/"+x.file);
 }
 res.json(rows);
});

app.get("/api/apartments/:id",(req,res)=>{
 const a=db.prepare("SELECT * FROM apartments WHERE id=?").get(req.params.id);
 if(!a) return res.status(404).json({error:"Not found"});
 a.images=db.prepare("SELECT file FROM apartment_images WHERE apartment_id=?").all(a.id).map(x=>"/uploads/"+x.file);
 res.json(a);
});

app.post("/api/bookings",auth,upload.single("receipt"),async(req,res)=>{
 if(req.session.user.role!=="student") return res.status(403).json({error:"Students only"});
 if(!req.file) return res.status(400).json({error:"Receipt image/PDF is required"});
 const a=db.prepare("SELECT * FROM apartments WHERE id=?").get(req.body.apartment_id);
 if(!a) return res.status(404).json({error:"Apartment not found"});
 const bed=req.body.bed_type;
 const prices={single:a.single_price,double:a.double_price,triple:a.triple_price};
 const capacities={single:a.single_beds,double:a.double_beds,triple:a.triple_beds};
 if(!prices[bed] || !capacities[bed]) return res.status(400).json({error:"This bed type is not available"});
 const existing=db.prepare("SELECT COUNT(*) c FROM bookings WHERE apartment_id=? AND bed_type=? AND status IN ('pending','confirmed')").get(a.id,bed).c;
 if(existing>=capacities[bed]) return res.status(400).json({error:"No beds available for this type"});
 const {deposit,commission,total}=calculate(prices[bed]);
 const info=db.prepare(`INSERT INTO bookings(user_id,apartment_id,bed_type,monthly_rent,deposit,commission,total,receipt)
 VALUES(?,?,?,?,?,?,?,?)`).run(req.session.user.id,a.id,bed,prices[bed],deposit,commission,total,req.file.filename);
 const booking=db.prepare(`SELECT b.*,u.name student_name,u.phone,a.title apartment_title FROM bookings b
 JOIN users u ON u.id=b.user_id JOIN apartments a ON a.id=b.apartment_id WHERE b.id=?`).get(info.lastInsertRowid);
 try{await sendBookingEmail(booking);}catch(e){console.error("Email error:",e.message)}
 res.json({ok:true,booking});
});

app.get("/api/my-bookings",auth,(req,res)=>{
 const rows=db.prepare(`SELECT b.*,a.title apartment_title,a.area FROM bookings b JOIN apartments a ON a.id=b.apartment_id
 WHERE b.user_id=? ORDER BY b.id DESC`).all(req.session.user.id);
 res.json(rows);
});

app.post("/api/admin/apartments",admin,upload.fields([{name:"images",maxCount:6},{name:"video",maxCount:1}]),(req,res)=>{
 const {title,area,address,description,status,single_price,double_price,triple_price,single_beds,double_beds,triple_beds}=req.body;
 if(!title||!area) return res.status(400).json({error:"Title and area required"});
 const video=req.files?.video?.[0]?.filename||null;
 const info=db.prepare(`INSERT INTO apartments(title,area,address,description,video,status,single_price,double_price,triple_price,single_beds,double_beds,triple_beds)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(title,area,address||"",description||"",video,status||"available",
 Number(single_price||0),Number(double_price||0),Number(triple_price||0),
 Number(single_beds||0),Number(double_beds||0),Number(triple_beds||0));
 const ins=db.prepare("INSERT INTO apartment_images(apartment_id,file) VALUES(?,?)");
 for(const f of (req.files?.images||[])) ins.run(info.lastInsertRowid,f.filename);
 res.json({ok:true,id:info.lastInsertRowid});
});

app.delete("/api/admin/apartments/:id",admin,(req,res)=>{
 db.prepare("DELETE FROM apartment_images WHERE apartment_id=?").run(req.params.id);
 db.prepare("DELETE FROM apartments WHERE id=?").run(req.params.id);
 res.json({ok:true});
});

app.get("/api/admin/bookings",admin,(req,res)=>{
 const rows=db.prepare(`SELECT b.*,u.name student_name,u.email,u.phone,a.title apartment_title
 FROM bookings b JOIN users u ON u.id=b.user_id JOIN apartments a ON a.id=b.apartment_id ORDER BY b.id DESC`).all();
 res.json(rows);
});

app.post("/api/admin/bookings/:id/status",admin,(req,res)=>{
 const allowed=["pending","confirmed","rejected"];
 if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Bad status"});
 db.prepare("UPDATE bookings SET status=? WHERE id=?").run(req.body.status,req.params.id);
 res.json({ok:true});
});

app.get("/api/admin/reports",admin,(req,res)=>{
 const r=db.prepare(`SELECT
 COUNT(*) total_bookings,
 COALESCE(SUM(monthly_rent),0) rents,
 COALESCE(SUM(deposit),0) deposits,
 COALESCE(SUM(commission),0) commissions,
 COALESCE(SUM(total),0) totals
 FROM bookings WHERE status='confirmed'`).get();
 res.json(r);
});

app.get("/api/admin/students",admin,(req,res)=>{
 res.json(db.prepare("SELECT id,name,email,phone,created_at FROM users WHERE role='student' ORDER BY id DESC").all());
});
// صفحة تسجيل الأدمن
app.get("/register-admin", (req, res) => {
  res.send(`
    <html dir="rtl">
      <head><title>تسجيل أدمن جديد</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2>تسجيل حساب أدمن جديد - سكنك</h2>
        <form action="/api/register-admin" method="POST" style="display: inline-block; text-align: right;">
          <label>الاسم:</label><br><input type="text" name="name" required style="width: 100%; padding: 8px; margin: 5px 0;"><br>
          <label>البريد الإلكتروني:</label><br><input type="email" name="email" required style="width: 100%; padding: 8px; margin: 5px 0;"><br>
          <label>كلمة المرور:</label><br><input type="password" name="password" required style="width: 100%; padding: 8px; margin: 5px 0;"><br><br>
          <button type="submit" style="padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer;">إنشاء الحساب</button>
        </form>
      </body>
    </html>
  `);
});

// معالجة تسجيل الأدمن
// معالجة تسجيل الأدمن وتحديث كلمة السر تلقائياً
// معالجة تسجيل الأدمن وتحديث كلمة السر تلقائياً
app.post("/api/register-admin", (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const defaultPhone = "01000000000"; // رقم هاتف افتراضي لتخطي الشرط
    
    // مسح أي حساب قديم بنفس الإيميل لضمان عدم التعارض
    db.prepare("DELETE FROM users WHERE email = ?").run(email);

    // إنشاء حساب الأدمن الجديد شامل رقم الهاتف
    db.prepare("INSERT INTO users (name, email, password, phone, role) VALUES (?, ?, ?, ?, ?)").run(
      name, email, hashedPassword, defaultPhone, "admin"
    );

    res.send("<h3>تم تعيين حساب الأدمن بنجاح! يمكنك الآن <a href='/'>الرجوع وتسجيل الدخول</a></h3>");
  } catch (err) {
    res.send("حدث خطأ أثناء الإنشاء: " + err.message);
  }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;