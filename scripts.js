// ===== VARIABLES GLOBALES =====
let map, userMarker, userCircle;
let semaphoreMarkers = {}, semaphoreIntervals = {};
const COLOR_SEQUENCE = ['GREEN','YELLOW','RED'];
const COLOR_MAP = {GREEN:'color-green',YELLOW:'color-yellow',RED:'color-red'};
const USER_LOCATION_KEY = 'userLocation';
const SEMAPHORES_KEY = 'semaphores';

// ===== MAPA Y GEOLOCALIZACION =====
function initMap(){
    map = L.map('map').setView([40.4168,-3.7038],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'&copy; OpenStreetMap contributors'
    }).addTo(map);

    loadInitialLocation();
    loadSemaphores();
}

function loadInitialLocation(){
    const stored = localStorage.getItem(USER_LOCATION_KEY);
    if(stored){
        const {lat,lng} = JSON.parse(stored);
        map.setView([lat,lng],16);
        startUserTracking();
    } else { getUserLocation(true); }
}

function getUserLocation(save){
    if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(
            pos=>{
                const lat=pos.coords.latitude, lng=pos.coords.longitude;
                if(save){
                    localStorage.setItem(USER_LOCATION_KEY,JSON.stringify({lat,lng}));
                    map.setView([lat,lng],16);
                    startUserTracking();
                }
            },
            err=>{console.error(err); alert('No se pudo obtener ubicación.');},
            {enableHighAccuracy:true,timeout:5000,maxAge:0}
        );
    } else alert('Tu navegador no soporta geolocation.');
}

let currentWatchId=null;
function startUserTracking(){
    if(currentWatchId!==null) navigator.geolocation.clearWatch(currentWatchId);
    if(navigator.geolocation){
        currentWatchId = navigator.geolocation.watchPosition(
            pos=>{
                const lat=pos.coords.latitude,lng=pos.coords.longitude,acc=pos.coords.accuracy;
                const latlng=[lat,lng];
                if(!userMarker){
                    userMarker=L.marker(latlng).addTo(map).bindPopup("Tu posición");
                    userCircle=L.circle(latlng,{radius:acc,color:'blue',fillOpacity:0.2}).addTo(map);
                } else {
                    userMarker.setLatLng(latlng);
                    userCircle.setLatLng(latlng).setRadius(acc);
                }
                map.panTo(latlng);
            },
            err=>console.error('Error seguimiento',err),
            {enableHighAccuracy:true,maximumAge:0}
        );
    }
}

// ===== CRUD SEMÁFOROS =====
function loadSemaphores(){
    const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
    Object.values(semaphoreMarkers).forEach(m=>m.remove());
    Object.values(semaphoreIntervals).forEach(i=>clearInterval(i));
    semaphoreMarkers={}; semaphoreIntervals={};
    document.getElementById('semaphore-list').innerHTML='';
    stored.forEach(s=>{
        createSemaphoreMarker(s);
        addSemaphoreToSidebar(s);
        startTrafficLightCycle(s);
    });
}

function saveSemaphores(sems){ localStorage.setItem(SEMAPHORES_KEY,JSON.stringify(sems)); }

function clearAllSemaphores(){
    if(!confirm('¿Eliminar todos?')) return;
    Object.values(semaphoreIntervals).forEach(i=>clearInterval(i));
    Object.values(semaphoreMarkers).forEach(m=>m.remove());
    semaphoreIntervals={}; semaphoreMarkers={};
    localStorage.removeItem(SEMAPHORES_KEY);
    document.getElementById('semaphore-list').innerHTML='';
    alert('Todos eliminados.');
}

function addSemaphore(){
    const name=document.getElementById('sem-name').value.trim();
    const startColor=document.getElementById('sem-start-color').value;
    const timeGreen=parseInt(document.getElementById('sem-time-green').value,10);
    const timeYellow=parseInt(document.getElementById('sem-time-yellow').value,10);
    const timeRed=parseInt(document.getElementById('sem-time-red').value,10);
    if(!name||isNaN(timeGreen)||isNaN(timeYellow)||isNaN(timeRed)||timeGreen<1||timeYellow<1||timeRed<1){
        return alert('Completa nombre y tiempos válidos.');
    }
    const center=map.getCenter();
    const newS={id:Date.now(),name,lat:center.lat,lng:center.lng,
        times:{GREEN:timeGreen,YELLOW:timeYellow,RED:timeRed},
        currentColor:startColor,
        currentTime:(startColor==='GREEN'?timeGreen:(startColor==='YELLOW'?timeYellow:timeRed))
    };
    const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
    stored.push(newS); saveSemaphores(stored);
    createSemaphoreMarker(newS);
    addSemaphoreToSidebar(newS);
    startTrafficLightCycle(newS);
    document.getElementById('sem-name').value='';
}

function createSemaphoreMarker(sem){
    const iconHtml=`<div id="sem-icon-${sem.id}" class="semaphore-icon ${COLOR_MAP[sem.currentColor]}"></div>`;
    const marker=L.marker([sem.lat,sem.lng],{
        icon:L.divIcon({className:'custom-div-icon',html:iconHtml,iconSize:[14,14]}),
        draggable:true
    }).addTo(map).bindPopup(`<b>${sem.name}</b><br>Color: ${sem.currentColor}<br>Tiempo: ${sem.currentTime}s`);
    marker.on('dragend',e=>updateSemaphoreLocation(sem.id,e.target.getLatLng().lat,e.target.getLatLng().lng));
    semaphoreMarkers[sem.id]=marker;
}

function updateSemaphoreLocation(id,lat,lng){
    const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
    const index=stored.findIndex(s=>s.id===id);
    if(index!==-1){ stored[index].lat=lat; stored[index].lng=lng; saveSemaphores(stored); }
}

function addSemaphoreToSidebar(sem){
    const list=document.getElementById('semaphore-list');
    let item=document.getElementById(`list-item-${sem.id}`);
    if(!item){ item=document.createElement('li'); item.className='semaphore-item'; item.id=`list-item-${sem.id}`; list.appendChild(item); }
    const timeHTML=`
        <div class="timer-config" id="timer-config-${sem.id}">
            <label>Verde:</label><input type="number" value="${sem.times.GREEN}" min="1" onchange="updateSemaphoreTime(${sem.id},'GREEN',this.value)">
            <label>Amarillo:</label><input type="number" value="${sem.times.YELLOW}" min="1" onchange="updateSemaphoreTime(${sem.id},'YELLOW',this.value)">
            <label>Rojo:</label><input type="number" value="${sem.times.RED}" min="1" onchange="updateSemaphoreTime(${sem.id},'RED',this.value)">
        </div>
    `;
    item.innerHTML=`
        <div class="semaphore-header" onclick="toggleTimerConfig(${sem.id})">
            <span class="semaphore-name">${sem.name}</span>
            <div class="color-status-group">
                <span id="list-time-${sem.id}">${sem.currentTime}s</span>
                <div id="list-color-${sem.id}" class="semaphore-color-indicator ${COLOR_MAP[sem.currentColor]}"></div>
            </div>
        </div>
        ${timeHTML}
        <div class="action-buttons"><button onclick="removeSemaphore(${sem.id})">🗑️ Eliminar</button></div>
    `;
}

function toggleTimerConfig(id){
    const cfg=document.getElementById(`timer-config-${id}`);
    cfg.classList.toggle('open');
}

function removeSemaphore(id){
    if(!confirm('¿Eliminar este semáforo?')) return;
    if(semaphoreIntervals[id]){ clearInterval(semaphoreIntervals[id]); delete semaphoreIntervals[id]; }
    if(semaphoreMarkers[id]) map.removeLayer(semaphoreMarkers[id]);
    delete semaphoreMarkers[id];
    const item=document.getElementById(`list-item-${id}`);
    if(item) item.remove();
    const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
    saveSemaphores(stored.filter(s=>s.id!==id));
}

function updateSemaphoreTime(id,color,value){
    const time=parseInt(value,10);
    if(isNaN(time)||time<1) return loadSemaphores();
    const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
    const index=stored.findIndex(s=>s.id===id);
    if(index!==-1){
        stored[index].times[color]=time;
        if(stored[index].currentColor===color) stored[index].currentTime=time;
        saveSemaphores(stored);
        startTrafficLightCycle(stored[index]);
    }
}

// ===== CICLO SEMÁFORO =====
function startTrafficLightCycle(sem){
    if(semaphoreIntervals[sem.id]) clearInterval(semaphoreIntervals[sem.id]);
    function step(){
        const stored=JSON.parse(localStorage.getItem(SEMAPHORES_KEY)||'[]');
        const s=stored.find(x=>x.id===sem.id); if(!s) return clearInterval(semaphoreIntervals[sem.id]);
        if(s.currentTime>1) s.currentTime--;
        else {
            const next=COLOR_SEQUENCE[(COLOR_SEQUENCE.indexOf(s.currentColor)+1)%COLOR_SEQUENCE.length];
            s.currentColor=next; s.currentTime=s.times[next];
        }
        updateSemaphoreUI(s);
        const idx=stored.findIndex(x=>x.id===sem.id);
        if(idx!==-1){ stored[idx].currentColor=s.currentColor; stored[idx].currentTime=s.currentTime; saveSemaphores(stored); }
    }
    step();
    semaphoreIntervals[sem.id]=setInterval(step,1000);
}

function updateSemaphoreUI(sem){
    const colorClass=COLOR_MAP[sem.currentColor];
    const mapIcon=document.getElementById(`sem-icon-${sem.id}`);
    if(mapIcon) mapIcon.className=`semaphore-icon ${colorClass}`;
    const listColor=document.getElementById(`list-color-${sem.id}`);
    if(listColor) listColor.className=`semaphore-color-indicator ${colorClass}`;
    const listTime=document.getElementById(`list-time-${sem.id}`);
    if(listTime) listTime.textContent=`${sem.currentTime}s`;
    const marker=semaphoreMarkers[sem.id];
    if(marker) marker.getPopup().setContent(`<b>${sem.name}</b><br>Color: ${sem.currentColor}<br>Tiempo: ${sem.currentTime}s`);
}

// ===== DESPLEGABLE MENÚ (MÓVIL Y PC) =====
const toggleBtn=document.getElementById('menu-toggle');
const sidebar=document.getElementById('sidebar');
toggleBtn.addEventListener('click',()=>{ sidebar.classList.toggle('visible'); });

document.addEventListener('DOMContentLoaded',initMap);
