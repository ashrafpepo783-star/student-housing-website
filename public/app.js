async function api(url,opt={}){const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||"حدث خطأ");return d}
async function load(){const a=await api("/api/apartments");const box=document.querySelector("#cards");box.innerHTML=a.map(x=>`<article class="card">
${x.images?.[0]?`<img src="${x.images[0]}">`:""}
<h3>${x.title}</h3><p>${x.area}</p><p>${x.description||""}</p>
<p class="price">Single: ${x.single_price||"-"} جنيه</p><p class="price">Double: ${x.double_price||"-"} جنيه</p><p class="price">Triple: ${x.triple_price||"-"} جنيه</p>
<button onclick="book(${x.id})">احجز الآن</button></article>`).join("")}
async function book(id){
 const me=await api("/api/me"); if(!me.user){location.hash="login";return alert("سجل دخول أولاً")}
 const bed=prompt("اكتب نوع السرير: single أو double أو triple");
 if(!["single","double","triple"].includes(bed))return;
 const receipt=document.createElement("input");receipt.type="file";receipt.accept="image/*,application/pdf";receipt.click();
 receipt.onchange=async()=>{if(!receipt.files[0])return;const f=new FormData();f.append("apartment_id",id);f.append("bed_type",bed);f.append("receipt",receipt.files[0]);try{const x=await api("/api/bookings",{method:"POST",body:f});alert(`تم إرسال الحجز للمراجعة. الإجمالي ${x.booking.total} جنيه`);location.href="/student.html"}catch(e){alert(e.message)}}}
document.querySelector("#loginForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const x=await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});location.href=x.user.role==="admin"?"/admin.html":"/student.html"}catch(e){alert(e.message)}}
async function register(){const name=prompt("اسم الطالب"),email=prompt("الإيميل"),phone=prompt("رقم الهاتف"),password=prompt("كلمة المرور");if(!name||!email||!phone||!password)return;try{await api("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,email,phone,password})});location.href="/student.html"}catch(e){alert(e.message)}}
load();