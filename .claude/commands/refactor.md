Refactor $ARGUMENTS

Align component according to following conventions:

- One component in own directory, name the directory as component name
- Place component and prop type in file index.tsx, avoid using content of component in file that is named as component, use only index.tsx
- Create styles in module.css file according to component name
- verify that there are no unused styles in \*.module.css files
- if a css class has some pseudoclasses attached, prefer to use & syntax e.g., for example for class '.someStyle':
  .someStyle {
    display: block;

    &:hover {
    color: red;
    }
  }

- verify other components are following these conventions, if not following, update these components to meet above requirements
- if there is a potential code duplication, add TODO comment that indicates teh duplication and refer to place in code where is the another duplication
- verify all imports work as before the changes
- for colors in *.css files use only vscode specific colors e.g. with prefix --vscode-
