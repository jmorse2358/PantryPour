const storage_key="pantry_items_v1";
const default_difficulty=3;
const default_prep_time="2–3 mins";
const local_drink_db={};
const api_base="https://www.thecocktaildb.com/api/json/v1/1/";
const image_base="https://www.thecocktaildb.com/images/ingredients/";
const max_lookups=48;
const search_debounce_ms=150;
const endpoints={
  search_by_name:n=>api_base+"search.php?s="+encodeURIComponent(n),
  lookup_by_id:i=>api_base+"lookup.php?i="+encodeURIComponent(i),
  filter_by_ingredient:n=>api_base+"filter.php?i="+encodeURIComponent(n),
  list_all_ingredients:api_base+"list.php?i=list",
  ingredient_info:n=>api_base+"search.php?i="+encodeURIComponent(n)
};
const synonyms={
  "fresh lemon juice":"lemon juice",
  "fresh lime juice":"lime juice",
  "fresh orange juice":"orange juice",
  "sugar syrup":"simple syrup",
  "powdered sugar":"sugar",
  "superfine sugar":"sugar",
  "caster sugar":"sugar",
  "soda water":"club soda",
  "carbonated water":"club soda",
  "sparkling water":"club soda",
  "angostura bitters":"bitters"
};

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=s=>String(s==null?"":s).toLowerCase().trim().replace(/\s+/g," ");
const normalize=s=>{const n=clean(s);return synonyms[n]||n};
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
const stars=n=>"★".repeat(n)+"☆".repeat(5-n);

const fetch_cache=new Map();
function cached_fetch(url){
  if(!fetch_cache.has(url)){
    fetch_cache.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error("http_"+r.status);return r.json()}).catch(e=>{fetch_cache.delete(url);throw e}));
  }
  return fetch_cache.get(url);
}

function load_pantry(){
  try{const v=JSON.parse(localStorage.getItem(storage_key));return Array.isArray(v)?v:[]}catch(e){return[]}
}
function save_pantry(){
  try{localStorage.setItem(storage_key,JSON.stringify(pantry))}catch(e){show_toast("Couldn't save your pantry on this device")}
}
let pantry=load_pantry();
const in_pantry=name=>pantry.some(p=>normalize(p)===normalize(name));
function add_ingredient(name){
  if(in_pantry(name))return false;
  pantry.push(name);
  save_pantry();
  render_pantry();
  return true;
}
function remove_ingredient(name){
  pantry=pantry.filter(p=>normalize(p)!==normalize(name));
  save_pantry();
  render_pantry();
}

let toast_timer;
function show_toast(msg){
  const t=$("toast");
  t.textContent=msg;
  t.classList.add("show");
  clearTimeout(toast_timer);
  toast_timer=setTimeout(()=>t.classList.remove("show"),2200);
}

const overlay_stack=[];
function open_overlay(el){
  if(overlay_stack.some(o=>o.el===el))return;
  overlay_stack.push({el,opener:document.activeElement});
  el.removeAttribute("inert");
  el.setAttribute("aria-hidden","false");
  requestAnimationFrame(()=>{el.classList.add("open");const b=el.querySelector("[data-close]");if(b)b.focus({preventScroll:true})});
}
function close_top_overlay(){
  const top=overlay_stack.pop();
  if(!top)return;
  top.el.classList.remove("open");
  top.el.setAttribute("aria-hidden","true");
  top.el.setAttribute("inert","");
  top.el.querySelectorAll(".menu").forEach(m=>m.hidden=true);
  if(top.opener&&top.opener.focus)top.opener.focus({preventScroll:true});
}
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",close_top_overlay));
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(!$("confirm").hidden){close_confirm();return}
  close_top_overlay();
});
document.addEventListener("error",e=>{if(e.target&&e.target.tagName==="IMG")e.target.style.visibility="hidden"},true);

function bind_menu(btn,menu,state,on_change){
  btn.addEventListener("click",e=>{
    e.stopPropagation();
    const open=menu.hidden;
    menu.hidden=!open;
    btn.setAttribute("aria-expanded",String(open));
  });
  menu.addEventListener("click",e=>{
    const b=e.target.closest("button[data-key]");
    if(!b)return;
    state[b.dataset.key]=b.dataset.value;
    menu.querySelectorAll('button[data-key="'+b.dataset.key+'"]').forEach(x=>x.setAttribute("aria-checked",String(x===b)));
    menu.hidden=true;
    btn.setAttribute("aria-expanded","false");
    on_change();
  });
  document.addEventListener("click",e=>{
    if(!menu.hidden&&!menu.contains(e.target)){menu.hidden=true;btn.setAttribute("aria-expanded","false")}
  });
}

function render_pantry(){
  const list=$("pantry_list");
  $("pantry_count").textContent=pantry.length?pantry.length+(pantry.length===1?" ingredient":" ingredients")+" on your shelf":"Nothing on your shelf yet";
  if(!pantry.length){
    list.innerHTML='<div class="empty"><strong>Your pantry is empty</strong>Tap Add to stock the bottles and mixers you have at home.</div>';
    return;
  }
  list.innerHTML=pantry.map((p,i)=>'<div class="pantry_item"><span>'+esc(p)+'</span><button class="icon_btn" data-remove="'+i+'" aria-label="Remove '+esc(p)+'"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>').join("");
}
$("pantry_list").addEventListener("click",e=>{
  const b=e.target.closest("[data-remove]");
  if(b)remove_ingredient(pantry[Number(b.dataset.remove)]);
});

let all_ingredients=[];
const add_state={sort:"az",owned:"all"};
async function load_ingredients(){
  if(all_ingredients.length)return;
  $("add_list").innerHTML='<div class="status">Loading ingredients…</div>';
  try{
    const d=await cached_fetch(endpoints.list_all_ingredients);
    all_ingredients=(d.drinks||[]).map(x=>x.strIngredient1).filter(Boolean);
    render_ingredients();
  }catch(e){
    $("add_list").innerHTML='<div class="status">Couldn\'t load ingredients. Check your connection.<br><button id="retry_ingredients">Try again</button></div>';
  }
}
function render_ingredients(){
  if(!all_ingredients.length)return;
  const q=clean($("add_search").value);
  let items=all_ingredients.filter(n=>!q||clean(n).includes(q));
  if(add_state.owned==="hide")items=items.filter(n=>!in_pantry(n));
  items.sort((a,b)=>add_state.sort==="za"?b.localeCompare(a):a.localeCompare(b));
  const total=items.length;
  items=items.slice(0,80);
  if(!items.length){$("add_list").innerHTML='<div class="status">No ingredients match that search.</div>';return}
  $("add_list").innerHTML=items.map(n=>'<button class="tab" data-name="'+esc(n)+'"><img src="'+image_base+encodeURIComponent(n)+'-Small.png" alt="" loading="lazy" width="48" height="48"><span class="grow">'+esc(n)+'</span>'+(in_pantry(n)?'<span class="tag">In pantry</span>':'')+'</button>').join("")+(total>80?'<div class="status">Showing 80 of '+total+'. Keep typing to narrow it down.</div>':'');
}
$("add_list").addEventListener("click",e=>{
  if(e.target.id==="retry_ingredients"){load_ingredients();return}
  const b=e.target.closest(".tab");
  if(b)open_ingredient(b.dataset.name);
});
bind_menu($("add_menu_btn"),$("add_menu"),add_state,render_ingredients);
$("add_search").addEventListener("input",debounce(render_ingredients,search_debounce_ms));

let current_ingredient="";
async function open_ingredient(name){
  current_ingredient=name;
  const body=$("ingredient_body");
  body.innerHTML='<img class="hero contain" src="'+image_base+encodeURIComponent(name)+'-Medium.png" alt=""><div class="detail_body"><h2>'+esc(name)+'</h2><p id="ingredient_desc" class="status" style="padding:8px 0;text-align:left">Loading description…</p></div>';
  sync_ingredient_button();
  open_overlay($("ingredient_overlay"));
  try{
    const d=await cached_fetch(endpoints.ingredient_info(name));
    if(current_ingredient!==name)return;
    const info=d.ingredients&&d.ingredients[0];
    const text=info&&info.strDescription?info.strDescription.trim():"";
    const el=$("ingredient_desc");
    if(el){el.className="";el.style.cssText="";el.textContent=text?(text.length>420?text.slice(0,420).replace(/\s+\S*$/,"")+"…":text):"No description available for this ingredient."}
  }catch(e){
    const el=$("ingredient_desc");
    if(el&&current_ingredient===name)el.textContent="Couldn't load the description right now."
  }
}
function sync_ingredient_button(){
  const b=$("ingredient_add");
  const have=in_pantry(current_ingredient);
  b.disabled=have;
  b.textContent=have?"In your pantry":"Add to pantry";
}
$("ingredient_add").addEventListener("click",()=>{
  if(add_ingredient(current_ingredient)){
    show_toast(current_ingredient+" added");
    sync_ingredient_button();
    render_ingredients();
    close_top_overlay();
  }
});

const pool=new Map();
let current_drinks=[];
let drinks_token=0;
const drinks_state={sort:"match",show:"all",type:"all"};

function get_ingredients(d){
  const out=[];
  for(let i=1;i<=15;i++){
    const n=d["strIngredient"+i];
    if(n&&String(n).trim())out.push({name:String(n).trim(),measure:String(d["strMeasure"+i]||"").trim(),key:normalize(n)});
  }
  return out;
}
function score_drink(d){
  const keys=new Set(pantry.map(normalize));
  const ings=get_ingredients(d);
  const total_ingredients=ings.length;
  const match_count=ings.filter(x=>keys.has(x.key)).length;
  const missing_count=total_ingredients-match_count;
  const match_score=total_ingredients?match_count/total_ingredients:0;
  return{ings,total_ingredients,match_count,missing_count,match_score};
}
const get_difficulty=id=>(local_drink_db[id]&&local_drink_db[id].difficulty)||default_difficulty;
const get_prep_time=id=>(local_drink_db[id]&&local_drink_db[id].prep_time)||default_prep_time;

async function load_drink(id){
  if(pool.has(id))return;
  try{
    const d=await cached_fetch(endpoints.lookup_by_id(id));
    if(d.drinks&&d.drinks[0])pool.set(id,d.drinks[0]);
  }catch(e){}
}
async function refresh_drinks(){
  const token=++drinks_token;
  const q=$("drinks_search").value.trim();
  const status=$("drinks_status");
  if(!q&&!pantry.length){
    current_drinks=[];
    $("drinks_list").innerHTML="";
    status.innerHTML="Add a few ingredients to your pantry and the drinks you can make will show up here.";
    return;
  }
  if(!current_drinks.length){status.textContent="Mixing options…";$("drinks_list").innerHTML=""}
  try{
    let drinks=[];
    if(q){
      const d=await cached_fetch(endpoints.search_by_name(q));
      drinks=Array.isArray(d.drinks)?d.drinks:[];
      drinks.forEach(x=>pool.set(x.idDrink,x));
    }else{
      const lists=await Promise.all(pantry.map(n=>cached_fetch(endpoints.filter_by_ingredient(n)).then(d=>Array.isArray(d.drinks)?d.drinks:[]).catch(()=>[])));
      const counts=new Map();
      lists.forEach(l=>l.forEach(x=>counts.set(x.idDrink,(counts.get(x.idDrink)||0)+1)));
      const ids=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,max_lookups).map(e=>e[0]);
      await Promise.all(ids.map(load_drink));
      drinks=ids.map(id=>pool.get(id)).filter(Boolean);
    }
    if(token!==drinks_token)return;
    current_drinks=drinks;
    render_drinks();
  }catch(e){
    if(token!==drinks_token)return;
    $("drinks_list").innerHTML="";
    status.innerHTML='Couldn\'t reach TheCocktailDB. Check your connection.<br><button id="retry_drinks">Try again</button>';
  }
}
function render_drinks(){
  const status=$("drinks_status");
  let rows=current_drinks.map(d=>({d,s:score_drink(d)}));
  if(drinks_state.show==="full")rows=rows.filter(r=>r.s.missing_count===0);
  if(drinks_state.type==="alcoholic")rows=rows.filter(r=>r.d.strAlcoholic==="Alcoholic");
  if(drinks_state.type==="non")rows=rows.filter(r=>/non/i.test(r.d.strAlcoholic||""));
  const by_name=(a,b)=>a.d.strDrink.localeCompare(b.d.strDrink);
  rows.sort((a,b)=>{
    if(drinks_state.sort==="name")return by_name(a,b);
    if(drinks_state.sort==="missing")return a.s.missing_count-b.s.missing_count||b.s.match_score-a.s.match_score||by_name(a,b);
    return b.s.match_score-a.s.match_score||a.s.missing_count-b.s.missing_count||by_name(a,b);
  });
  if(!rows.length){
    $("drinks_list").innerHTML="";
    status.textContent=current_drinks.length?"No drinks fit these filters.":"No drinks found. Try adding more ingredients or another search.";
    return;
  }
  status.textContent="";
  $("drinks_list").innerHTML=rows.map(({d,s})=>{
    const a=(0.15+s.match_score*0.65).toFixed(2);
    const bg="linear-gradient(rgba(126,191,120,"+a+"),rgba(126,191,120,"+a+")),#fff";
    const info=s.total_ingredients+" ingredients"+(d.strAlcoholic?", "+d.strAlcoholic.toLowerCase():"");
    const diff=get_difficulty(d.idDrink);
    return '<button class="drink_card" data-id="'+esc(d.idDrink)+'" style="background:'+bg+'"><img src="'+esc(d.strDrinkThumb)+'/preview" alt="" loading="lazy" width="72" height="72"><span class="divider"></span><span class="card_body"><span class="card_top"><span class="card_name">'+esc(d.strDrink)+'</span><span class="stars" role="img" aria-label="Difficulty '+diff+' out of 5">'+stars(diff)+'</span></span><span class="card_info">'+esc(info)+'</span><span class="card_bottom"><span>'+esc(get_prep_time(d.idDrink))+'</span>'+(s.missing_count>0?'<span class="pill">'+s.missing_count+' missing</span>':'<span class="tag">Ready to make</span>')+'</span></span></button>';
  }).join("");
}
$("drinks_scroll").addEventListener("click",e=>{
  if(e.target.id==="retry_drinks"){refresh_drinks();return}
  const b=e.target.closest(".drink_card");
  if(b)open_drink(b.dataset.id);
});
bind_menu($("drinks_menu_btn"),$("drinks_menu"),drinks_state,render_drinks);
$("drinks_search").addEventListener("input",debounce(refresh_drinks,search_debounce_ms));

function open_drink(id){
  const d=pool.get(id);
  if(!d)return;
  const s=score_drink(d);
  const diff=get_difficulty(id);
  const history=(d.strCategory||"Cocktail")+(d.strAlcoholic?", "+d.strAlcoholic.toLowerCase():"")+". Served up from TheCocktailDB's collection of classic and modern recipes.";
  $("drink_body").innerHTML='<img class="hero" src="'+esc(d.strDrinkThumb)+'" alt="'+esc(d.strDrink)+'"><div class="detail_body"><h2>'+esc(d.strDrink)+'</h2><p>'+esc(history)+'</p><div class="meta_row"><span class="stars" style="font-size:18px" role="img" aria-label="Difficulty '+diff+' out of 5">'+stars(diff)+'</span><span>'+esc(get_prep_time(id))+'</span></div><h3>Ingredients</h3><ul class="ing_list">'+s.ings.map(x=>{
    const have=in_pantry(x.name);
    return '<li class="'+(have?"":"missing")+'"><span>'+esc(x.name)+(have?"":" (missing)")+'</span><span class="'+(have?"have":"")+'">'+esc(x.measure)+'</span></li>';
  }).join("")+'</ul><h3>Instructions</h3><p>'+esc(d.strInstructions||"No instructions provided.")+'</p><p class="attribution">Cocktail data and images provided by TheCocktailDB (CC BY 3.0)</p></div>';
  $("drink_body").scrollTop=0;
  open_overlay($("drink_overlay"));
}

function open_confirm(){
  if(!pantry.length){show_toast("Your pantry is already empty");return}
  $("confirm").hidden=false;
  $("confirm_no").focus();
}
function close_confirm(){
  $("confirm").hidden=true;
  $("open_clear").focus();
}
$("open_clear").addEventListener("click",open_confirm);
$("confirm_no").addEventListener("click",close_confirm);
$("confirm_yes").addEventListener("click",()=>{
  try{localStorage.removeItem(storage_key)}catch(e){}
  pantry=[];
  render_pantry();
  current_drinks=[];
  $("confirm").hidden=true;
  $("open_add").focus();
  show_toast("Pantry cleared");
});
$("confirm").addEventListener("click",e=>{if(e.target===$("confirm"))close_confirm()});

$("open_add").addEventListener("click",()=>{
  open_overlay($("add_overlay"));
  load_ingredients().then(render_ingredients);
});
$("open_drinks").addEventListener("click",()=>{
  open_overlay($("drinks_overlay"));
  refresh_drinks();
});

render_pantry();