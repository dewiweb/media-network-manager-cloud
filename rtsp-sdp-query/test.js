var sdp_geter = require("./index")


sdp_geter("rtsp://192.168.1.140:8081/by-name/A__mic8_1", (s) => { console.log("GOOD") ; console.log(s)})
sdp_geter("rtsp://192.168.1.140:8081/by-name/A__mic8_1zzzuuu", (s) => { console.log("BAD") ; console.log(s)})

