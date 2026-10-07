(function(){
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reveal(root=document){
    const nodes=root.querySelectorAll('.visual-reveal:not(.visual-visible)');
    if(reduce){nodes.forEach(n=>n.classList.add('visual-visible'));return;}
    if(!('IntersectionObserver' in window)){nodes.forEach(n=>n.classList.add('visual-visible'));return;}
    const io=new IntersectionObserver(entries=>entries.forEach(e=>{
      if(e.isIntersecting){e.target.classList.add('visual-visible');io.unobserve(e.target)}
    }),{threshold:.08,rootMargin:'0px 0px -50px 0px'});
    nodes.forEach(n=>io.observe(n));
  }
  function mark(){
    document.querySelectorAll('.main .view > *, .addon-grid > *, .category-grid > *, .panel, .empty-panel, .hero, .page-title, .section-head').forEach((el,i)=>{
      if(!el.classList.contains('visual-reveal')){el.classList.add('visual-reveal');el.style.setProperty('--visual-delay',(Math.min(i,8)*45)+'ms');}
    });
    reveal();
  }
  window.HL2WorkshopMotion={reveal,mark};
  document.addEventListener('DOMContentLoaded',()=>{
    mark();
    const app=document.getElementById('app');
    if(app){new MutationObserver(()=>mark()).observe(app,{subtree:true,childList:true});}
    setTimeout(mark,400);
  });
})();
