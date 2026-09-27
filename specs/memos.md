# The Memos

The skill that lets the agent structure code comments in a way that is comfortable for 
both the agent and humans.

# The Motivation

By default, most agents bloat the source code with comments. If you read the output
of an average model without the defined instructions for commenting, you'll see about 50% of the
code has comments and notices from the agent. This is a reasonable approach for the agent to apply
some additional information to the code so that it contains additional notices, but for the 
human eye, the code becomes extremely bloated and difficult to read.

The idea is to instruct the agent to output **only code, no comments at all**, and add the notices in
the special files. 

# The Approach

1. The agent is instructed to output no comments in code; only human-written comments are allowed.
2. The agent writes the code. When it wants to add a comment or notice, it is instructed to do 
the following instead:

    2.1. We have a special folder, `.agents/memos/`. In this folder our main sources directory is
    mirrored with spacial `*.md` files. For example, if we have `src/models/group.ts`, the agent will
    add the `.agents/memos/src/models/group.ts.md` file.

    2.2. When the agent outputs code and wants to add a comment to a certain line, instead of 
    writing it to the source file, it will write it into the corresponding `*.md` file in the `memos`
    folder, with the optional line and column mark.

By using this approach, all our source files will stay clean for humans to read and add 
some comments, while agents will also have all the required notices and information.
