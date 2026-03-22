// Custom Cursor Logic
const cursor = document.getElementById('custom-cursor');
document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
});

document.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'A' || 
        e.target.tagName === 'BUTTON' || 
        e.target.classList.contains('upload-area') || 
        e.target.tagName === 'INPUT') {
        cursor.classList.add('cursor-glow');
    }
});
document.addEventListener('mouseout', (e) => {
    if (e.target.tagName === 'A' || 
        e.target.tagName === 'BUTTON' || 
        e.target.classList.contains('upload-area') || 
        e.target.tagName === 'INPUT') {
        cursor.classList.remove('cursor-glow');
    }
});

// Three.js Space Background System
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050510, 0.002);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
const container = document.getElementById('canvas-container');
if (container) {
    container.appendChild(renderer.domElement);
}

// Drifting Particles (Space Dust / Stars)
const particlesGeometry = new THREE.BufferGeometry();
const particlesCount = 2000;
const posArray = new Float32Array(particlesCount * 3);
const colorsArray = new Float32Array(particlesCount * 3);
for(let i = 0; i < particlesCount * 3; i+=3) {
    posArray[i] = (Math.random() - 0.5) * 20;
    posArray[i+1] = (Math.random() - 0.5) * 20;
    posArray[i+2] = (Math.random() - 0.5) * 20;
    
    // Slight color variations between cyan, purple and white
    let rType = Math.random();
    if(rType > 0.8) {
        colorsArray[i] = 0; colorsArray[i+1] = 1; colorsArray[i+2] = 1; // Cyan
    } else if(rType > 0.6) {
        colorsArray[i] = 0.7; colorsArray[i+1] = 0; colorsArray[i+2] = 1; // Purple
    } else {
        colorsArray[i] = 1; colorsArray[i+1] = 1; colorsArray[i+2] = 1; // White
    }
}
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));

const material = new THREE.PointsMaterial({
    size: 0.04,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
});
const particlesMesh = new THREE.Points(particlesGeometry, material);
scene.add(particlesMesh);

// Floating 3D Geometric Shapes
const geo1 = new THREE.IcosahedronGeometry(0.5, 0);
const mat1 = new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true, transparent: true, opacity: 0.3 });
const shape1 = new THREE.Mesh(geo1, mat1);
shape1.position.set(-3, 2, -4);
scene.add(shape1);

const geo2 = new THREE.TorusGeometry(0.6, 0.1, 16, 100);
const mat2 = new THREE.MeshBasicMaterial({ color: 0xb500ff, wireframe: true, transparent: true, opacity: 0.2 });
const shape2 = new THREE.Mesh(geo2, mat2);
shape2.position.set(4, -2, -6);
scene.add(shape2);

const geo3 = new THREE.OctahedronGeometry(0.3, 0);
const mat3 = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.3 });
const shape3 = new THREE.Mesh(geo3, mat3);
shape3.position.set(-2, -3, -5);
scene.add(shape3);

camera.position.z = 5;

// Parallax Camera based on mouse movement
let mouseX = 0;
let mouseY = 0;
document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) - 0.5;
    mouseY = (event.clientY / window.innerHeight) - 0.5;
});

// Animation Loop (60fps)
function animate() {
    requestAnimationFrame(animate);
    
    // Slow drift of starfield
    particlesMesh.rotation.y += 0.0005;
    particlesMesh.rotation.x += 0.0002;
    
    // Rotate shapes
    shape1.rotation.x += 0.01;
    shape1.rotation.y += 0.005;
    
    shape2.rotation.y -= 0.005;
    shape2.rotation.z += 0.01;
    
    shape3.rotation.x -= 0.01;
    shape3.rotation.y -= 0.01;
    
    // Smooth camera pan based on mouse
    camera.position.x += (mouseX * 1.5 - camera.position.x) * 0.05;
    camera.position.y += (-mouseY * 1.5 - camera.position.y) * 0.05;
    camera.lookAt(scene.position);
    
    renderer.render(scene, camera);
}
animate();

// Handle Re-sizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// VanillaTilt logic for glass-panels
document.addEventListener('DOMContentLoaded', () => {
    const panels = document.querySelectorAll('.glass-panel');
    if (panels.length > 0 && typeof VanillaTilt !== 'undefined') {
        VanillaTilt.init(panels, {
            max: 10,
            speed: 400,
            glare: true,
            "max-glare": 0.2,
        });
    }
});
