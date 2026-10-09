
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import WorkspacePage from "../components/WorkspacePage";
import VentraHelper from "../components/help/VentraHelper";
export const metadata={title:"Ventra | Help & support"};
export default function Page(){return <WorkspacePage title="Help & support"><LocalizedElement as="p">Ask Ventra Guide how to use a section, find the right tool or understand an error. Choose English, فارسی or العربية. This guide explains product workflows; it does not access your account, analyse files or edit project records.</LocalizedElement><VentraHelper embedded /></WorkspacePage>}
