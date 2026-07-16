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
        title:"AI Copilot",
    },

    {
        icon:Settings,
        title:"Settings",
    }

];

export default function Sidebar(){

    return(

        <aside className="sidebar">

            <div className="sidebar-logo">

                <h2>

                    Ventra

                </h2>

            </div>

            <nav>

                {

                    menu.map((item,index)=>{

                        const Icon=item.icon;

                        return(

                            <button
                            key={index}
                            className="sidebar-item"
                            >

                                <Icon size={20}/>

                                <span>

                                    {item.title}

                                </span>

                            </button>

                        );

                    })

                }

            </nav>

        </aside>

    )

}