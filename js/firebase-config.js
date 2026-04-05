// js/firebase-config.js

// ٢. زانیارییەکانی Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCMgwV15hUX0kruGcSZ48zTRCYCG1dUf_k",
  authDomain: "dynamic-form-builder-51249.firebaseapp.com",
  projectId: "dynamic-form-builder-51249",
  storageBucket: "dynamic-form-builder-51249.firebasestorage.app",
  messagingSenderId: "451980092153",
  appId: "1:451980092153:web:aaeb3f6819e4639a3bb828"
};

// پەیوەستبوون (Initialize)
// تێبینی: ئێمە کتێبخانەی compat بەکاردێنین لە html بۆیە بەم شێوەیە دەینوسین
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const storage = firebase.storage();
// چارەسەری کێشەی هێڵی کۆڕەک و بلۆکبوونی WebSockets
// چارەسەری کێشەی هێڵی کۆڕەک و بلۆکبوونی WebSockets
db.settings({
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  merge: true // ئەم دێڕە زیادکرا بۆ لابردنی ئێرۆرەکەی کۆنسۆڵ
});