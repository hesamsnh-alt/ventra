export function resolveProject(pages){

    const project = {

        rooms:[],

        walls:[],

        doors:[],

        windows:[],

        finishes:[],

        schedules:[],

        legends:[],

        notes:[]

    };

    for(const page of pages){

        if(page.rooms){

            project.rooms.push(...page.rooms);

        }

        if(page.doors){

            project.doors.push(...page.doors);

        }

        if(page.windows){

            project.windows.push(...page.windows);

        }

        if(page.finishes){

            project.finishes.push(...page.finishes);

        }

        if(page.legends){

            project.legends.push(...page.legends);

        }

        if(page.notes){

            project.notes.push(...page.notes);

        }

    }

    return project;

}