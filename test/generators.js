import * as jsc from "jsverify";

import { StatementBuilder, AgentBuilder } from '../src/builder';


export const email = jsc.pair(jsc.asciinestring, jsc.small(jsc.asciinestring)).smap(
    (pieces) => {
        let [local, domain] = pieces;
        return `${local}@${domain}`;
    },
    (email) => {
        let at = email.lastIndexOf('@');
        return [email.slice(0, at), email.slice(at+1)];
    }
);

function capitalize(s) {
    return s[0].toUpperCase() + s.slice(1);
}

function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}


// okay, so first we need to figure out how to generate method picks -- first, a oneof
// of a bunch of tuple generators, each tuple containing compatible-argument methods
// the first member of the tuple is generated as being one of the methods,
// then the rest are generated as the arguments
// we make a certain number of them, and apply them to our builder

// if we're making a statement we include the minimal methods for a legal statement
// maybe we somehow get them all in random order though?

// hmmm... consider making normal JS versions too? Yeah

// would it be better to create classes for these so there're fewer implicit
// data structure requirements?

function combine_arrays(parts) {
    console.log("combining", parts);
    let [required, optionals] = parts;
    return required.concat(optionals);
}

function split_arrays(number_required) {
    return (array) => [
        array.slice(0, number_required),
        array.slice(number_required)
    ]
}

function compile(Builder) {
    return (operations) => {
        console.log("All operations!", operations);
        let entity = Builder.builder();
        operations.forEach((operation) => {
            const op = operation[0];
            const args = operation.slice(1);
            entity = entity[op](...args);
        })
        console.log("entity!", entity);
        console.log("made...", entity.build());
        return entity.build();
    }
}

function munge(name, insert) {
    return "with" + insert + name.slice(4);
}

function unmunge(name, insert) {
    return "with" + name.slice(4 + insert.length);
}




function modify_first(func) {
    return (insert) => {
        return (pieces) => [func(pieces[0], insert)].concat(pieces.slice(1))
    };
}

const munge_pieces = modify_first(munge);
const unmunge_pieces = modify_first(unmunge)


function decompile_agent_statement(statement) {
    console.log("shrinking!", statement);
    const actor_parts = decompile_agent(statement.actor);
    const object_parts = decompile_agent(statement.object);
    return [].concat(
        actor_parts.map(munge_pieces("Actor")),
        [["withVerb", statement.verb.id]],
        object_parts.map(munge_pieces("Object"))
    );
}

function decompile_agent(agent) {
    console.log("shrinking!", agent);
    const identifying = [];
    const others = [];
    for(let prop of Object.getOwnPropertyNames(agent)) {
        switch(prop) {
            case 'member':
                agent.member.forEach((member) => {
                    identifying.push(['withMember', member]);
                });
                break;
            case 'mbox':
            case 'mbox_sha1sum':
            case 'openid':
            case 'account':
                identifying.push(['with' + capitalize(prop), agent[prop]]);
                break;
            case 'name':
                others.push(['withName', agent.name]);
                break;
            case 'objectType':
                if(agent.objectType == 'Group') {
                    others.push(['asGroup']);
                }
                break;
        }
    }
    // just get super aggressive here to prevent recursion issues
    return identifying.slice(0, 1);
    // shuffleArray(identifying);
    // const operations = identifying.slice(0,1).concat(shuffleArray(identifying.slice(1).concat(others)));
    // console.log(operations);
    // return operations;
}

export const { agent, just_agent, just_agent_minimal_part, agent_minimal_part } = jsc.letrec((tie) => {
    return {
        just_agent_minimal_part: jsc.oneof(
            jsc.tuple([
                jsc.oneof(["withEmail", "withMbox", "withOpenid", "withMbox_sha1sum"].map(jsc.constant)),
                jsc.asciinestring
            ]),
            jsc.tuple([
                jsc.constant("withAccount"),
                jsc.record({
                    homePage: jsc.asciinestring,
                    name: jsc.asciinestring
                })
            ])
        ),
        just_agent: jsc.tuple([
            jsc.tuple([tie("just_agent_minimal_part")]),
            jsc.small(jsc.array(
                jsc.tuple([jsc.constant("withName"), jsc.asciinestring])
            ))
        ]).smap(
            combine_arrays, split_arrays(1)
        ).smap(
            compile(AgentBuilder), decompile_agent
        ),
        agent_minimal_part: jsc.oneof(
            jsc.tuple([jsc.constant("withMember"), tie("just_agent")]),
            tie("just_agent_minimal_part")
        ),
        agent: jsc.tuple([
            jsc.tuple([
                tie("agent_minimal_part")
            ]),
            jsc.small(jsc.array(
                jsc.oneof(
                    jsc.tuple([jsc.constant("withMember"), tie("just_agent")]),
                    jsc.tuple([jsc.constant("asGroup")]),
                    jsc.tuple([jsc.constant("withName"), jsc.asciinestring])
                )
            ))
        ]).smap(
            combine_arrays, split_arrays(1)
        ).smap(
            compile(AgentBuilder), decompile_agent
        )
    };
});

// one thing this is doing is making clear the usefulness of the state machine approach



const actor_verb = jsc.tuple([
    jsc.oneof(
        jsc.tuple([agent_minimal_part]).smap(munge_pieces("Actor"), unmunge_pieces("Actor")),
        jsc.tuple([jsc.constant("withActor"), agent])
    ),
    jsc.tuple([
        jsc.constant("withVerb"),
        jsc.oneof(
            jsc.record({id: jsc.asciinestring}),
            jsc.record({id: jsc.asciinestring, display: jsc.record({en: jsc.asciinestring})})
        )
    ])
]);

const actor_verb_agent = jsc.pair(
    actor_verb,
    jsc.tuple([jsc.oneof(
        jsc.tuple([jsc.constant("withObject"), agent]),
        jsc.tuple([jsc.constant("withObjectMember"), just_agent]),
        jsc.tuple([
            jsc.oneof(["withObjectEmail", "withObjectMbox", "withObjectOpenid", "withObjectMbox_sha1sum"].map(jsc.constant)),
            jsc.asciinestring // good enough for now
        ]),
        jsc.tuple([
            jsc.constant("withObjectAccount"),
            jsc.record({
                homePage: jsc.asciinestring,
                name: jsc.asciinestring
            })
        ])
    )])
).smap(
    combine_arrays,
    split_arrays(2)
)

export let agent_statement = actor_verb_agent.smap(
    compile(StatementBuilder),
    decompile_agent_statement
)



// export let activity_statement =
