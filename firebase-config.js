const firebaseConfig = {
  apiKey: "AIzaSyC-iLxizH1umfeHSUZHLvpAt6XNm21p90Y",
  authDomain: "tanksduel-b90c7.firebaseapp.com",
  databaseURL: "https://tanksduel-b90c7-default-rtdb.firebaseio.com",
  projectId: "tanksduel-b90c7",
  storageBucket: "tanksduel-b90c7.firebasestorage.app",
  messagingSenderId: "952596856224",
  appId: "1:952596856224:web:96294ab2212bbdd769f8c5",
  measurementId: "G-L2XVXMBQ1Y"
};

firebase.initializeApp(firebaseConfig);
const firebaseDatabase = firebase.database();
window.db = firebaseDatabase;
