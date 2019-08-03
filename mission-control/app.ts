
var mdns = require('multicast-dns')()
var arp = require('node-arp');
var os = require('os');
var sock = require('ws');
var exp = require('express')

var pc_name = os.hostname()
var prename = pc_name.split('.')[0];
var Data = []

const wss = new sock.Server({ port: 16060 })
wss.on('connection', function connection(ws) {
    console.log("new client connected")
    ws.on('message', function incoming(message) {
        Data.push(JSON.parse(message))
      console.log('received: %s', Data);
      processSwitchData()
    });
   
  });

mdns.on('response', (response) => {
    handleResponse(response)
})


mdns.on('query', (query) => {
    if(query.questions.some(k => k.name == "_missioncontrol._socketio.local")) {

        mdns.respond({
            answers: [{
              name: 'missioncontrol_'+prename+'._missioncontrol._socketio.local',
              type: 'SRV',
              data: {
                port:16060,
                weigth: 0,
                priority: 10,
                target: prename+'.local'
              }
            }]
          })
    }

})

mdns.respond({
    answers: [{
      name: 'missioncontrol_'+prename+'._missioncontrol._socketio.local',
      type: 'SRV',
      data: {
        port:16060,
        weigth: 0,
        priority: 10,
        target: prename+'.local'
      }
    }]
  })

let Hosts : object = {};
let Services : object = {}
let getMacClear = true;

function handleResponse(response) {
    for(let k of response.answers){
        handleItem(k)
    }
    for(let k of response.additionals){
        handleItem(k)
    }

    function handleItem(k) {
        let refresh = false;
        if(k.type == "SRV")
        {
            //console.log(k)
            if(Hosts[k.data.target]) {
                
                let subs = (Hosts[k.data.target].Services[k.name])? Hosts[k.data.target].Services[k.name].subs : [];
                if(Services[k.name]) {
                    refresh = (subs == Services[k.name])? refresh : true;
                    subs = Services[k.name]
                }
                if(!Hosts[k.data.target].Services[k.name])
                    refresh = true;
                Hosts[k.data.target].Services[k.name] = {
                    port: k.data.port,
                    subs : subs
                }
            }
        }
        else if(k.type == "PTR")
        {
            let comps = k.name.split("._");
            if(comps[1] == "sub" ){
                if(!Services[k.data] ){
                    Services[k.data] = []
                }
                if(!Services[k.data].some(p => p === comps[0]) && comps[2] == "http") Services[k.data].push(comps[0])
            } 
            //console.log(k)
        }
        else if(k.type == "A")
        {
            //console.log(k)
            let getmac = false
            if(!Hosts[k.name]) {
                Hosts[k.name] = {
                    IP: k.data,
                    Services: {},
                    OtherIPs: [],
                    Macs: []
                }
                getmac = true
            } 
            else if(Hosts[k.name].IP != k.data) {
                if(!Hosts[k.name].OtherIPs.some(p => p == k.data)) {
                    Hosts[k.name].OtherIPs.push(Hosts[k.name].IP)
                    Hosts[k.name].IP = k.data
                    getmac = true
                }
            }   

            if(getmac) {
                waitClearGetMac()
                function waitClearGetMac() {
                    if(!getMacClear) {
                        setTimeout(waitClearGetMac, 100);
                    }
                    else {
                        getMacClear = false;
                        arp.getMAC(k.data, function(err, mac) {
                            if (!err) {
                                Hosts[k.name].Macs.push(mac);
                            }
                            getMacClear = true
                        });
                    }
                }
            }
        }
        //if(refresh) console.log(Hosts)
    }
}

mdns.query({
    questions:[{
      name: '_http._tcp.local',
      type: 'SRV'
    }]
  })


  function buildServiceHttpLink(obj) {

  }



function processSwitchData() {
    var linkd = []
    let conns = [];

    // Detecting interconnect
    for(let i in Data) {
        console.log(Data[i])
        if(!linkd[i]) linkd[i] = {}
        linkd[i].dataRef = i;
        linkd[i].ports = [];
        conns[i] = []
        for(let j : number =0 ; j < Data.length ; j++) {
            console.log("Lookimg for " + Data[j].Mac)
            for(let l in Data[i].Ports) {
                if(Data[i].Ports[l].ConnectedMacs.some(k => k == Data[j].Mac)) {
                    if(!linkd[i].ports[l] ) linkd[i].ports[l] = []
                    if(!linkd[i].ports[l].some(k => k == j)) linkd[i].ports[l].push(j);
                }
            }
        }
    }
    console.log(linkd)

    console.log(linkd.filter(k => k.ports.some(l => l.length > 1)))
    // Building connection graph
}