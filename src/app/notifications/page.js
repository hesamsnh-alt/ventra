
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import WorkspacePage from "../components/WorkspacePage";import Link from "next/link";export default function Page(){return <WorkspacePage title="Project activity"><LocalizedElement as="p">Open a project to review its activity, reports and issues.</LocalizedElement><LocalizedLink  href="/dashboard#projects">Choose a project</LocalizedLink><LocalizedElement as="p">Email and push notifications are not configured in this version.</LocalizedElement></WorkspacePage>}
