// These contracts come from native activity projections, not the chosen render clip.
const interactions=[
 {id:'bath',model:'bathtub',interaction:0,ticks:200,activity:20,actions:[19],identity:'socket',clip:'bath'},
 {id:'shower',model:'shower',interaction:0,ticks:170,activity:12,actions:[0],identity:'sound',sound:1,clip:'shower'},
 {id:'handwash',model:'sink',interaction:0,ticks:160,activity:16,actions:[21],identity:'sound',sound:3,clip:'prepare'},
 {id:'toilet',model:'toilet',interaction:0,ticks:155,activity:13,actions:[18],identity:'socket',clip:'toilet'},
 {id:'television',model:'television',interaction:0,ticks:210,activity:14,actions:[7,8],identity:'label'},
 {id:'radio',model:'radio',interaction:0,ticks:200,activity:18,actions:[7,8],identity:'label'},
 {id:'letters',model:'desk',interaction:0,ticks:200,activity:19,actions:[0,8],identity:'label'},
 {id:'fish',model:'reference_shelf',interaction:0,ticks:200,activity:10,actions:[7],identity:'label',clip:'watch_fish'},
];

// Installed only in the isolated test browser. Capture and preflight share this observer.
function installObserver(){
 window.observeRepairInteraction=(spec,actor,fixture,label)=>{
  const s=__terriStress.sim,row=Array.from(s.ids()).indexOf(actor);
  if(row<0)throw Error('Observed actor disappeared');
  const state={action:s.visualActions()[row],activity:s.activities()[row],support:s.interactionTargets()[row],
   sound:s.soundActions()[row],soundSource:s.soundSources()[row],current:s.actionQueueOf(actor,1)[0]??null,
   position:[s.positions()[row*2],s.positions()[row*2+1]]};
  const ownsOrder=state.current===label,usingExpectedActivity=state.activity===spec.activity;
  const ownsPresentation=spec.identity==='socket'?state.support===fixture:spec.identity==='sound'?state.sound===spec.sound&&state.soundSource===fixture:true;
  const presentationValid=spec.actions.includes(state.action)&&ownsPresentation;
  if(ownsOrder&&usingExpectedActivity&&!presentationValid)throw Error('Active order has an invalid presentation: '+JSON.stringify({spec,fixture,state}));
  let expectedClip=spec.clip,expectedFixture=null;
  if(['bath','shower','toilet'].includes(spec.id))expectedFixture=fixture;
  if(['handwash','fish'].includes(spec.id)&&ownsOrder&&usingExpectedActivity&&state.support!==0xffffffff)throw Error('Object-facing action unexpectedly has socket ownership');
  if(['television','radio','letters'].includes(spec.id)){
   if(state.action===8){
    const kinds={armchair:'armchair',reading_chair:'reading',chair:'dining',desk_chair:'office',sofa:'ottoman',long_sofa:'sofa'};
    const model=s.objectModel(state.support)?.id;
    if(ownsOrder&&usingExpectedActivity&&!kinds[model])throw Error('Seated action has no valid seat');
    expectedFixture=state.support;expectedClip='seat_'+kinds[model]+'_sit';
   }else{
    expectedClip=spec.id==='letters'?'idle':'watch_fish';
    if(ownsOrder&&usingExpectedActivity&&state.support!==0xffffffff)throw Error('Standing action unexpectedly has socket ownership');
   }
  }
  return{...state,ownsOrder,usingExpectedActivity,presentationValid,expectedClip,expectedFixture,
   active:ownsOrder&&usingExpectedActivity,released:!ownsOrder};
 };
}
module.exports={interactions,installObserver};
