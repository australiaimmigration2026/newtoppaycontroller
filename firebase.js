// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCtc1Lb4_nRyC74OpqniYXA_9OzzPKms78",
  authDomain: "toppay-2bd66.firebaseapp.com",
  projectId: "toppay-2bd66",
  storageBucket: "toppay-2bd66.firebasestorage.app",
  messagingSenderId: "372853268456",
  appId: "1:372853268456:web:32ffcfa9a80e5bde50ce5d",
  measurementId: "G-E1F7SYC5JB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);