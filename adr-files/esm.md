# ECMAScript Modules (ESM)

## Status

Accepted.

## Context

Modern JavaScript is using ECMAScript (ES) modules over CommonJS.

## Decision

There are 2 methods to using ES modules: renaming files with the MJS file extension or defining the "type" of the project to "module" in the 'package.json' file.

Renaming all of the files in this project to use the alternate file extension causes files to lose their change history in Github. I did not want to concede the ability to compare previous versions of the code base.

I also did not want specify the file extension in "import" statements. As a result, I chose to launch node with the '--experimental-specifier-resolution=node' start up argument.

Lastly, I wanted to use native JavaScript without any transpilers.

## Consequences

The experimental flag for specifying the node loader is not available in production. Therefore, I have to run using 'development' as the node environment set in NODE\_ENV.

I also cannot launch node from the Docker file with ES modules enabled. I am instead forced to revert to using a start up script defined in the 'package.json' from the Dockerfile.

Finally, Jest does not support ESM imports with its 'mock' function. The feature is not support as of the time of this decision. I decided to switch to Vite as the test driver since its implementation mirrors Jest and it has full support for ESM including 'mock'.

## References

* [NodeJS API Reference](https://nodejs.org/api/cli.html#--input-typetype)
* [Missing ESM Support for jest.mock](https://github.com/facebook/jest/issues/10025)
* [node --experimental-modules, requested module does not provide an export named](https://stackoverflow.com/questions/47277887/node-experimental-modules-requested-module-does-not-provide-an-export-named)
