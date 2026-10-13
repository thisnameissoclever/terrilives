from pathlib import Path
import subprocess, hashlib, json, os, re
evidence=Path(__file__).resolve().parent
root=evidence.parents[2]
cases=[
 ("arrival cap", "crates/terri-sim/src/social_company.rs", "episode.extensions < 2", "episode.extensions < 3", "actual_newcomer_arrivals_extend_each_participant_at_most_twice", False),
 ("sampler bypass", "crates/terri-sim/src/social_episode.rs", r"topic_weight\(\s*value,\s*theirs.get\(tag\).copied\(\).unwrap_or\(0\.\),\s*inclination,?\s*\)", "value + inclination * 0.0", "topic_sampler_uses_social_capacity_across_fixed_seeds_and_excludes_own_dislikes", True),
 ("release incoming on start", "crates/terri-sim/src/social_episode.rs", "episodes.rendezvous.remove(&partner);", "let _ = partner;", "newcomer_waits_for_running_conversation_without_stealing_the_partner", False),
 ("replace conversation topic", "crates/terri-sim/src/social_episode.rs", "episodes.topics.remove(&initiator);", "let _ = initiator;", "same_tick_conversation_redirect_chooses_the_new_listeners_preference", False),
 ("prune dead peers", "crates/terri-sim/src/social_episode.rs", "episode.participants.remove(&person);", "let _ = episode;", "death_tick_prunes_topic_owners_and_communal_peer_references_before_save", False),
 ("recipient talk preemption", "crates/terri-sim/src/systems/action.rs", "crate::social_episode::cancel_incoming(world, agent);", "let _ = &mut *world;", "recipient_player_talk_preempts_inbound_waiter_and_preserves_unrelated_orders", False),
 ("whole recipe busy guard", "crates/terri-sim/src/systems/movement.rs", "target.is_some() || chain || reading", "target.is_some() || (chain && false) || reading", "waiting_talker_follows_cooking_stations_and_waits_for_the_entire_recipe", False),
 ("completed work freeze", "crates/terri-sim/src/reading.rs", ".is_some_and(|e| e.completed_novelty.is_some())", ".is_some_and(|e| e.completed_novelty.is_some() && false)", "communal_reading_keeps_completed_book_company_without_repeating_earnings", False),
 ("held chair Comfort", "crates/terri-sim/src/reading.rs", "needs.fill(NeedId::Comfort, comfort);", "let _ = (&mut needs, comfort);", "communal_reading_keeps_completed_book_company_without_repeating_earnings", False),
]
env=os.environ.copy(); env["CARGO_BUILD_JOBS"]="2"
results=[]
groups=[[0,1,3,4],[2,5,6],[7],[8]]
for group_number,indices in enumerate(groups,1):
 originals={}
 try:
  for index in indices:
   name,relative,needle,replacement,test,regex=cases[index]
   path=root/relative; originals.setdefault(path,path.read_bytes()); source=path.read_text()
   if name=="completed work freeze":
    split=source.index("fn read_tick("); prefix,part=source[:split],source[split:]
    assert needle in part,name
    mutated=prefix+part.replace(needle,replacement,1)
   elif regex:
    mutated,count=re.subn(needle,replacement,source); assert count==1,(name,count)
   else:
    assert needle in source,name
    mutated=source.replace(needle,replacement) if name=="arrival cap" else source.replace(needle,replacement,1)
   path.write_text(mutated)
  test_filter="social_episode::tests" if len(indices)>1 else cases[indices[0]][4]
  command=["cargo","test","-p","terri-sim",test_filter,"--","--test-threads=2"]
  print("START grouped mutation variant "+str(group_number),flush=True)
  result=subprocess.run(command,cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600)
 finally:
  for path,original in originals.items():path.write_bytes(original)
 restored=all(path.read_bytes()==original for path,original in originals.items())
 log=evidence/("social-mutation-group-"+str(group_number)+".log");log.write_text(result.stdout)
 for index in indices:
  name,relative,needle,replacement,test,regex=cases[index]
  failed=("::"+test+" ... FAILED") in result.stdout
  killed=result.returncode!=0 and "test result: FAILED" in result.stdout and failed
  record={"mutation":name,"group":group_number,"file":relative,"command":command,"exit_code":result.returncode,"killed":killed,"restored":restored,"sha256":hashlib.sha256(originals[root/relative]).hexdigest(),"log":str(log)}
  results.append(record);print(json.dumps(record),flush=True)
 (evidence/"social-mutations.json").write_text(json.dumps(results,indent=2))
 assert restored and all(r["killed"] for r in results if r["group"]==group_number),(group_number,result.stdout[-4000:])
print("All lifecycle mechanisms deleted and caught; every production file restored byte-for-byte.",flush=True)
