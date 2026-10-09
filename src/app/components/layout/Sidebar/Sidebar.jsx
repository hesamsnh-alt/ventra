
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";
import Link from "next/link";
import "./Sidebar.css";

import {

    LayoutDashboard,

    FolderOpen,

    Calculator,

    FileText,

    BarChart3,

    Bot,

    Settings

} from "lucide-react";

const menu = [

    {
        icon:LayoutDashboard,
        title:"Dashboard",
    },

    {
        icon:FolderOpen,
        title:"Projects",
    },

    {
        icon:Calculator,
        title:"Estimating",
    },

    {
        icon:FileText,
        title:"BOQ",
    },

    {
        icon:BarChart3,
        title:"Reports",
    },

    {
        icon:Bot,
        title:"Drawing Analysis",
    },

    {
        icon:Settings,
        title:"Settings",
    }

];

export default function Sidebar(){

    return(

        <LocalizedElement as="aside" className="sidebar">

            <LocalizedElement as="div" className="sidebar-logo">

                <LocalizedElement as="h2">

                    Ventra

                </LocalizedElement>

            </LocalizedElement>

            <LocalizedElement as="nav">

                {

                    menu.map((item,index)=>{

                        const Icon=item.icon;

                        return(

                            <LocalizedLink  href={["/dashboard","/dashboard#projects","/tools/estimate","/tools/boq","/tools/reports","/tools/drawings","/profile"][index]}
                            key={index}
                            className="sidebar-item"
                            >

                                <Icon size={20}/>

                                <LocalizedElement as="span">

                                    {item.title}

                                </LocalizedElement>

                            </LocalizedLink>

                        );

                    })

                }

            </LocalizedElement>

        </LocalizedElement>

    )

}