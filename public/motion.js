(function(){
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const splash=document.getElementById('siteSplash');
  let finished=false;
  function finishSplash(){
    if(finished)return; finished=true;
    document.body.classList.remove('site-loading');
    if(splash){splash.classList.add('hide');setTimeout(()=>splash.remove(),900);}
  }
  if(reduce) finishSplash();
  else { window.addEventListener('load',()=>setTimeout(finishSplash,3600),{once:true}); setTimeout(finishSplash,4500); }
  window.HL2Motion={
    reveal(root=document){
      const nodes=root.querySelectorAll('.reveal:not(.visible)');
      if(reduce||!('IntersectionObserver' in window)){nodes.forEach(n=>n.classList.add('visible'));return;}
      const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}}),{threshold:.08,rootMargin:'0px 0px -40px 0px'});
      nodes.forEach(n=>io.observe(n));
    }
  };
  document.addEventListener('DOMContentLoaded',()=>window.HL2Motion.reveal());
})();
