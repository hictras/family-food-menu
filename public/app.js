const recipeDialog=document.getElementById("recipeDialog");
const menuDialog=document.getElementById("menuDialog");
const familyDialog=document.getElementById("familyDialog");
const recipeForm=document.getElementById("recipeForm");
const menuForm=document.getElementById("menuForm");
const familyForm=document.getElementById("familyForm");
const recipeSelect=document.getElementById("menuRecipe");
const calendarEl=document.getElementById("calendar");

let recipes=[];
let calendar=null;
let selectedDate=null;
let currentRange={start:null,end:null};
let pushSubscription=null;

const mealColors={
  Breakfast:"#f4a261",
  Lunch:"#2a9d8f",
  Dinner:"#264653",
  Snack:"#e76f51"
};

async function requestJSON(url,options={}){
  const response=await fetch(url,{
    headers:{"Content-Type":"application/json"},
    ...options
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}

function escapeHTML(value=""){
  return String(value)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadRecipes(){
  recipeSelect.disabled=true;
  recipeSelect.innerHTML=`<option value="">Loading recipes...</option>`;
  try{
    recipes=await requestJSON("/api/recipes");
    renderRecipeOptions();
  }catch(error){
    console.error(error);
    recipeSelect.innerHTML=`<option value="">Could not load recipes</option>`;
    alert(error.message);
  }finally{
    recipeSelect.disabled=false;
  }
}

function renderRecipeOptions(){
  recipeSelect.innerHTML=recipes.length
    ? recipes.map(r=>`<option value="${r.id}">${escapeHTML(r.title)} — ${r.meal_type}</option>`).join("")
    : `<option value="">No recipes yet</option>`;
}

function getRecipeById(id){
  return recipes.find(r=>String(r.id)===String(id));
}

function openRecipeDialog(recipe=null){
  document.getElementById("recipeDialogTitle").textContent=recipe?"Edit Recipe":"New Recipe";
  document.getElementById("recipeId").value=recipe?.id||"";
  document.getElementById("title").value=recipe?.title||"";
  document.getElementById("mealType").value=recipe?.meal_type||"Dinner";
  document.getElementById("description").value=recipe?.description||"";
  document.getElementById("ingredients").value=recipe?.ingredients||"";
  document.getElementById("steps").value=recipe?.steps||"";
  recipeDialog.showModal();
}

function resetRecipeForm(){
  document.getElementById("recipeId").value="";
  document.getElementById("title").value="";
  document.getElementById("mealType").value="Dinner";
  document.getElementById("description").value="";
  document.getElementById("ingredients").value="";
  document.getElementById("steps").value="";
}

recipeForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=recipeForm.querySelector("button[type='submit']");
  button.disabled=true;
  button.textContent="Saving...";

  const recipeId=document.getElementById("recipeId").value;
  const payload={
    title:document.getElementById("title").value.trim(),
    meal_type:document.getElementById("mealType").value,
    description:document.getElementById("description").value.trim(),
    ingredients:document.getElementById("ingredients").value.trim(),
    steps:document.getElementById("steps").value.trim()
  };

  try{
    if(!payload.title) throw new Error("Please enter a recipe title.");

    if(recipeId){
      await requestJSON(`/api/recipes/${recipeId}`,{method:"PUT",body:JSON.stringify(payload)});
    }else{
      await requestJSON("/api/recipes",{method:"POST",body:JSON.stringify(payload)});
    }

    recipeDialog.close();
    resetRecipeForm();
    await loadRecipes();
    await loadMenu();
  }catch(error){
    alert(error.message||"Could not save the recipe.");
  }finally{
    button.disabled=false;
    button.textContent="Save Recipe";
  }
});

function openMenuDialog(date){
  selectedDate=date;
  document.getElementById("menuDate").value=date;
  menuDialog.showModal();
}

menuForm.addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    await requestJSON("/api/menu",{
      method:"POST",
      body:JSON.stringify({
        recipe_id:Number(recipeSelect.value),
        menu_date:document.getElementById("menuDate").value,
        meal_type:document.getElementById("menuMealType").value
      })
    });
    menuDialog.close();
    await loadMenu();
  }catch(error){
    alert(error.message);
  }
});

async function loadMenu(){
  if(!currentRange.start||!currentRange.end) return;

  const mealFilter=document.getElementById("mealFilter").value;
  const meals=await requestJSON(`/api/menu?start=${currentRange.start}&end=${currentRange.end}`);
  const filtered=mealFilter?meals.filter(m=>m.meal_type===mealFilter):meals;

  calendar.removeAllEvents();

  filtered.forEach(meal=>{
    calendar.addEvent({
      id:String(meal.id),
      title:`${meal.meal_type}: ${meal.title}`,
      start:meal.menu_date,
      allDay:true,
      backgroundColor:mealColors[meal.meal_type]||"#2f6f4f",
      extendedProps:meal
    });
  });

  if(selectedDate) renderDayPanel(selectedDate,filtered);
}

function renderDayPanel(date,meals){
  selectedDate=date;
  const panel=document.getElementById("dayPanel");
  document.getElementById("dayPanelTitle").textContent=new Date(date).toDateString();

  const dayMeals=meals.filter(m=>m.menu_date===date);
  const container=document.getElementById("dayPanelMeals");

  container.innerHTML=dayMeals.length
    ? dayMeals.map(meal=>`
      <article class="meal-card meal-${meal.meal_type.toLowerCase()}" style="--meal-color:${mealColors[meal.meal_type]}">
        <h3>${meal.meal_type}</h3>
        <p><strong>${escapeHTML(meal.title)}</strong></p>
        <p>${escapeHTML(meal.description||"")}</p>
        <button onclick='openRecipeDialog(${JSON.stringify(meal).replaceAll("'", "&#39;")})'>View recipe</button>
      </article>`).join("")
    : `<p>No meals planned for this day.</p>`;

  panel.classList.remove("hidden");
}

function initializeCalendar(){
  calendar=new FullCalendar.Calendar(calendarEl,{
    initialView:"dayGridWeek",
    firstDay:1,
    height:"auto",
    headerToolbar:{left:"prev,next today",center:"title",right:""},
    datesSet:async info=>{
      currentRange={
        start:info.startStr.slice(0,10),
        end:info.endStr.slice(0,10)
      };
      await loadMenu();
    },
    dateClick:info=>openMenuDialog(info.dateStr),
    eventClick:info=>{
      const meal=info.event.extendedProps;
      const recipe=getRecipeById(meal.recipe_id)||meal;
      openRecipeDialog(recipe);
    },
    eventContent:arg=>{
      const meal=arg.event.extendedProps;
      return{
        html:`<div class="calendar-meal"><strong>${meal.meal_type}</strong><span>${escapeHTML(meal.title)}</span></div>`
      };
    }
  });
  calendar.render();
}

document.querySelectorAll(".view-switch button").forEach(button=>{
  button.onclick=()=>{
    document.querySelectorAll(".view-switch button").forEach(b=>b.classList.remove("active"));
    button.classList.add("active");
    calendar.changeView(button.dataset.view);
  };
});

document.getElementById("mealFilter").onchange=loadMenu;
document.getElementById("addRecipeBtn").onclick=()=>openRecipeDialog();
document.getElementById("familyBtn").onclick=()=>familyDialog.showModal();
document.getElementById("closeRecipe").onclick=()=>recipeDialog.close();
document.getElementById("cancelRecipe").onclick=()=>recipeDialog.close();
document.getElementById("closeMenu").onclick=()=>menuDialog.close();
document.getElementById("cancelMenu").onclick=()=>menuDialog.close();
document.getElementById("closeFamily").onclick=()=>familyDialog.close();
document.getElementById("cancelFamily").onclick=()=>familyDialog.close();
document.getElementById("closeDayPanel").onclick=()=>document.getElementById("dayPanel").classList.add("hidden");
document.getElementById("addMealForDay").onclick=()=>selectedDate&&openMenuDialog(selectedDate);

document.getElementById("enablePush").onclick=async()=>{
  try{
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){
      document.getElementById("familyStatus").textContent="Notifications were not allowed.";
      return;
    }

    const config=await requestJSON("/api/config");
    if(!config.vapidPublicKey){
      document.getElementById("familyStatus").textContent="Push keys are not configured on the server.";
      return;
    }

    await navigator.serviceWorker.register("/sw.js");
    const registration=await navigator.serviceWorker.ready;

    function urlBase64ToUint8Array(base64String){
      const padding="=".repeat((4-base64String.length%4)%4);
      const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
      const raw=atob(base64);
      return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
    }

    pushSubscription=await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(config.vapidPublicKey)
    });

    document.getElementById("familyStatus").textContent="Notifications enabled. Now click Save.";
  }catch(error){
    document.getElementById("familyStatus").textContent=error.message;
  }
};

familyForm.addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    await requestJSON("/api/family",{
      method:"POST",
      body:JSON.stringify({
        name:document.getElementById("memberName").value,
        phone:document.getElementById("memberPhone").value,
        subscription:pushSubscription
      })
    });
    document.getElementById("familyStatus").textContent="Saved! You will receive menu updates.";
  }catch(error){
    document.getElementById("familyStatus").textContent=error.message;
  }
});

document.addEventListener("DOMContentLoaded",async()=>{
  await loadRecipes();
  initializeCalendar();
});
 document.getElementById("notifyBtn").addEventListener("click", async () => {
  const button = document.getElementById("notifyBtn");

  button.disabled = true;
  button.textContent = "Sending...";

  try {
    await requestJSON("/api/notify", {
      method: "POST",
      body: JSON.stringify({
        title: "Family Food Menu",
        body: "This is a test notification."
      })
    });

    alert("Test notification sent to all subscribed family members.");
  } catch (error) {
    console.error(error);
    alert(error.message || "Could not send the test notification.");
  } finally {
    button.disabled = false;
    button.textContent = "📨 Send Test Notification";
  }
});