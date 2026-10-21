import { forwardRef } from 'react';
import { Link as RouterLink, NavLink as RouterNavLink, useLocation, type LinkProps, type NavLinkProps, type To } from 'react-router-dom';
import { projectHref } from './project';
export * from 'react-router-dom';
function scoped(to: To): To {
  return typeof to === 'string' ? projectHref(to) : { ...to, search: new URL(projectHref(`${window.location.pathname}${to.search || ''}${to.hash || ''}`), window.location.origin).search };
}
export const Link = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  useLocation();
  return <RouterLink {...props} to={scoped(props.to)} ref={ref} />;
});
export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>((props, ref) => {
  useLocation();
  return <RouterNavLink {...props} to={scoped(props.to)} ref={ref} />;
});
