import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '../lib/branding';
function Mark({src}:{src:string}){
 const [failed,setFailed]=useState('');
 return <img className="brand-image" src={failed===src?'/brand.svg':src} alt="" onError={()=>setFailed(src)} />;
}
export function Brand({footer=false}:{footer?:boolean}){
 const brand=useBranding();
 return <Link to="/" className={footer?'brand-footer':'brand'} title={footer?brand.domain:brand.name} aria-label={`${brand.name} home${footer?' · '+brand.domain:''}`}>
  <Mark src={brand.logoUrl}/><span className={footer?'brand-domain':'brand-text'}>{footer?brand.domain:brand.name}</span>
 </Link>;
}
