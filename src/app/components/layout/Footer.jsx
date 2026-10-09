
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
export default function Footer(){return <LocalizedElement as="footer" className="footer"><LocalizedElement as="div" className="footer-container"><LocalizedElement as="div" className="footer-brand"><LocalizedElement as="h2">Ventra</LocalizedElement><LocalizedElement as="p">Project drawings, estimates and commercial documents.</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="footer-links">{[[["Products","/products"],["Dashboard","/dashboard"],["Tools","/tools"],["Pricing","/pricing"],["Billing","/billing"]],[["About","/about"],["Resources","/resources"],["Help / Support","/support"]],[["Privacy","/legal/privacy"],["Terms","/legal/terms"],["Security","/legal/security"]]].map((group,i)=><LocalizedElement as="div" key={i}>{group.map(([label,url])=><LocalizedLink  key={url} href={url}>{label}</LocalizedLink>)}</LocalizedElement>)}</LocalizedElement></LocalizedElement><LocalizedElement as="div" className="footer-bottom">© 2026 Ventra</LocalizedElement></LocalizedElement>}
