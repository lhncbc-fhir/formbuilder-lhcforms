(function () {
  'use strict';

  angular.module('formBuilder').controller('SideNavCtrl',
    ['$scope', 'formBuilderService', '$timeout', 'FileUploader', '$http', '$log', 'smoothScroll', '$mdDialog', 'dataConstants',
    function ($scope, formBuilderService, $timeout, FileUploader, $http, $log, smoothScroll, $mdDialog, dataConstants) {

      // URL options for searching questions and panels in lforms-service.
      $scope.formsUrl = dataConstants.searchFormsURL;
      $scope.questionsUrl = dataConstants.searchQuestionsURL;
      $scope.watchDeregisters = {};

      // Flags to manipulate screen widgets in item add dialog
      $scope.addOrImport = {mode: 'import'};
      $scope.importLoincItem = {mode: dataConstants.PANEL};

      // Autocomp settings
      $scope.autocompSearch = {
        title: "Search LOINC question",
        opts: {
          url: $scope.formsUrl,
          matchListValue: true,
          autocomp: true,
          suggestionMode: 0,
          // Disable results caching. We are using different urls at run time
          // for same autocomplete element. Using cache gives wrong results.
          useResultCache: false
        },
        model: {text: '', code: '', value: ''}
      };



      /**
       * Create watch expressions of watch fields
       */
      $scope.watchExpressions = {
        // Basic tab
        question:           'selectedNode.lfData.basic.itemHash["/question/1"].value',
        questionCode:       'selectedNode.lfData.basic.itemHash["/questionCode/1"].value',
        questionCodeSystem: 'selectedNode.lfData.basic.itemHash["/questionCodeSystem/1"].value',
        header:             'selectedNode.lfData.basic.itemHash["/header/1"].value',
        dataType:           'selectedNode.lfData.basic.itemHash["/dataType/1"].value',
        externallyDefined:  'selectedNode.lfData.basic.itemHash["/externallyDefined/1"].value',
        editable:           'selectedNode.lfData.basic.itemHash["/editable/1"].value',
        answerRequired:     'selectedNode.lfData.basic.itemHash["/answerRequired/1"].value',
        answers:            'selectedNode.lfData.basic.itemHash["/answers/1"].value',
        multipleAnswers:    'selectedNode.lfData.basic.itemHash["/multipleAnswers/1"].value',
        defaultAnswer:      'selectedNode.lfData.basic.itemHash["/defaultAnswer/1"].value',
        units:              'selectedNode.lfData.basic.itemHash["/units/1"].value',
        calculationMethod:  'selectedNode.lfData.basic.itemHash["/calculationMethod/1"].value',

        // Advanced tab
        useRestrictions:    'selectedNode.lfData.advanced.itemHash["/useRestrictions/1"].value',
        useSkipLogic:       'selectedNode.lfData.advanced.itemHash["/useSkipLogic/1"].value'
      };

      /**
       * Options for angular-ui-tree. See https://github.com/angular-ui-tree/angular-ui-tree
       * for details.
       *
       * @type {{dropped: Function}}
       */
      $scope.treeOptions = {
        /**
         * Drag and drop method. If the source and destination is the same,
         * the event is treated as click().
         * @param event
         * @returns {boolean} - True if drag and drop, false if click() is
         * identified.
         */
        dropped: function (event) {
          // Identify click event
          if (event.source.index === event.dest.index &&
            event.source.nodesScope === event.dest.nodesScope) {
            event.source.nodeScope.click(event.source.nodeScope);
            return false;
          }
          else {
            // Re-arrange the ids and update the widget on the content pane.
            $scope.updateIdsAndAncestralCustomCodes(event.source.nodeScope.$modelValue);
            $scope.selectNode(event.source.nodeScope.$modelValue);
            return true;
          }
        },


        /**
         * Removing a node structurally modifies the tree. Update the ancestral codes.
         *
         * @param nodeScope - Angular-ui-tree nodeScope of the removed node.
         */
        removed: function (nodeScope) {
          var ancestors = formBuilderService.getAncestralNodes($scope.formBuilderData.treeData, nodeScope.$modelValue);
          formBuilderService.changeItemCodeToCustomCode(ancestors);
        }
      };


      /**
       * Click handler
       *
       * @param {Object} scope - Scope of the node clicked
       */
      $scope.click = function (scope) {
        var node = scope.$modelValue;
        if(node) {
          // Select only if clicked on non selected node.
          if(!$scope.selectedNode || node.id !== $scope.selectedNode.id) {
            $scope.selectNode(node);
          }
        }
      };


      /**
       * Keep a reference to selected node
       *
       * @param node - Node to select
       */
      $scope.selectNode = function(node) {
        // When switching the node selection, reflect changes in form builder in preview

        // Save any edits or cleanups on currently selected node.
        if($scope.selectedNode) {
          // Remove watches before switching the node.
          deregisterDirtyCheckWatches($scope);
          if($scope.selectedNode.isDirty) {
            $scope.updateIdsAndAncestralCustomCodes($scope.selectedNode);
            $scope.selectedNode.isDirty = false;
          }
          formBuilderService.processNodeTree($scope.formBuilderData.treeData);
        }

        // Select new node
        $scope.setSelectedNode(node);

        formBuilderService.updateNodeLFData($scope.selectedNode).then(function () {
          $scope.previewWidget();
          setDirtyCheckWatches($scope);
        });
      };


      /**
       * See if edits to this node impacts its ancestors
       *
       * @param node - Node to check for changes.
       */
      $scope.updateIdsAndAncestralCustomCodes = function(node) {
        formBuilderService.updateTreeIds($scope.formBuilderData.treeData);
        var ancestors = formBuilderService.getAncestralNodes($scope.formBuilderData.treeData, node);
        formBuilderService.changeItemCodeToCustomCode(ancestors);
      };


      /**
       * Click handler to remove tree branch.
       *
       *  - Make sure to assign node selection to next logical node
       *
       * @param scope - Scope of the node clicked
       */
      $scope.removeBranch = function (scope) {
        var nextSelect = nextSelection(scope);
        scope.remove();
        if(nextSelect === null) {
          // No other nodes. This is the only one
          $scope.setSelectedNode(null);
          $scope.previewWidget();
          return;
        }

        $scope.selectNode(nextSelect);
        $scope.previewWidget();
      };


      /**
       * Get nodeScope given a node's id. Refer to angular-ui-tree docs
       * for differences between nodeScope and nodesScope.
       *
       * @param rootNodesScope {Object} - Top level nodesScope of the tree.
       * @param nodeId {String} - Node id as defined in our node model of angular-ui-tree.
       * @returns {Object} - nodeScope of the identified node.
       */
      $scope.getNodeScopeById = function (rootNodesScope, nodeId) {
        if(!nodeId || !rootNodesScope) {
          return null;
        }

        var ret = null;
        var parentArray = rootNodesScope.childNodes();
        var idList = nodeId.split('.');
        for(var i = 0, len = idList.length; i < len; i++) {
          ret = parentArray[parseInt(idList[i]) - 1];
          if(!ret) {
            ret = null;
            break;
          }
          parentArray = ret.$childNodesScope.childNodes();
        }

        return ret;
      };


      /**
       * Identify next selection, usually needed when currently selected node is removed.
       * Order of priority:
       *   currently selected node, if it is outside the branch of target scope.
       *   Next sibling, if exists.
       *   previous sibling, if exists.
       *   parent if exists
       *   null if none of the above.
       * @param thisScope
       * @returns {null|*} - Returns a node for next selection.
       */
      function nextSelection(thisScope) {
        var thisId = thisScope.$modelValue.id;
        var selectedId = $scope.selectedNode.id;
        var nextSelected = $scope.selectedNode;
        if(selectedId === thisId || selectedId.startsWith(thisId+'.')) {
          var siblings = thisScope.siblings();
          if(siblings.length > 1) {
            var i = thisScope.$index + 1; // select next
            if(thisScope.$last) {
              i = thisScope.$index - 1; // this is last of siblings, select previous
            }
            nextSelected = siblings[i].$modelValue;
          }
          else if (thisScope.$parentNodeScope && thisScope.$parentNodeScope.$modelValue) { // no siblings, select parent
            nextSelected = thisScope.$parentNodeScope.$modelValue;
          }
          else { // No parent and no sibling => no other node
            nextSelected = null;
          }
        }

        return nextSelected;
      }


       /**
       * Expand/collapse handler
       *
       * @param scope - Scope of the node clicked
       */
      $scope.toggle = function (scope) {
        scope.toggle();
      };


      /**
       * Handler to add child item.
       *
       * @param {Object} scope - Scope of the node clicked
       * @param {Object} importedItem - Optional. An imported item to add as the child item,
       *        typically from lforms-service. If not provided, an empty new item will
       *        be created as the child item.
       * @param insertType - Constant to indicate insertion type such as before, after etc.
       */
      $scope.insertNewItem = function (scope, importedItem, insertType) {
        var newNode = formBuilderService.createTreeNode();
        if(!importedItem) {
          newNode.lfData = formBuilderService.createLFData();
          if(scope.importLoincItem.mode === dataConstants.PANEL) {
            // Set header
            newNode.lfData.basic.itemHash[dataConstants.HEADER_ID].value = {text: 'Yes', code: true};
            newNode.lfData.basic.itemHash[dataConstants.DATATYPE_ID].value = {code: 'SECTION'};
          }
          setItemName(newNode, scope.name);
        }
        else {
          newNode.lfData = importedItem; //TODO
        }
        newNode.previewItemData = formBuilderService.convertLfData(newNode.lfData); //TODO


        var contextScope, insertionIndex, thisId;
        if(scope.$modelValue) {
          thisId = scope.$modelValue.id;
        }
        switch (insertType) {
          case dataConstants.INSERT_BEFORE:
            contextScope = scope.$parentNodesScope;
            insertionIndex = parseInt(thisId.substring(thisId.lastIndexOf('.')+1)) - 1;
            break;
          case dataConstants.INSERT_AFTER:
            contextScope = scope.$parentNodesScope;
            insertionIndex = parseInt(thisId.substring(thisId.lastIndexOf('.')+1));
            break;
          case dataConstants.INSERT_AS_CHILD:
            contextScope = scope.$childNodesScope;
            insertionIndex = contextScope.childNodes().length;
            break;
          case dataConstants.APPEND_TO_ROOT:
            contextScope = scope.getRootNodesScope();
            insertionIndex = contextScope.childNodes().length;
            break;
        }


        if(!contextScope) {
          contextScope = scope.getRootNodesScope();
        }
        contextScope.insertNode(insertionIndex, newNode);
        calculateIds();
        $scope.selectNode(newNode);
      };


      /**
       * Calculate ids of the tree starting from root.
       */
      function calculateIds() {
        var qRoot = $scope.getRootNodesScope().$modelValue;
        assignId(qRoot, []);
      }


      /**
       * Recursive method to assign id to the tree nodes.
       * The ids indicate tree hierarchy to user; ex: 1.1.1 etc.
       *
       * @param nodeList - List of top level nodes
       * @param pathArray - Ancestor path of nodeList.
       */
      function assignId(nodeList, pathArray) {
        nodeList.forEach(function (node, index) {
          pathArray.push(index + 1);
          node.id = pathArray.join('.');
          if (node.nodes && node.nodes.length > 0) {
            node.lfData.basic.itemHash[dataConstants.HEADER_ID].value = {text: 'Yes', code: true};
            assignId(node.nodes, pathArray);
          }
          else {
          }
          pathArray.pop();
        });
      }


      /**
       * Handler to add button from the template.
       *
       * @param {Object} scope - Scope of the node.
       */
      $scope.addNewFromDialog = function (scope) {
        if($scope.addOrImport.mode === 'add') {
          gtag('event', 'add-custom-item', {
            event_category: 'engagement',
            event_label: scope.importLoincItem.mode
          });
          $scope.insertNewItem(scope, null, scope.insertType);
          $scope.previewWidget();
          $scope.closeDialog();
        }
      };


      /**
       * Set item name. A utility to initialize widget question and node title.
       *
       * @param {Object} selectedNode
       * @param {String} itemName
       */
      function setItemName(selectedNode, itemName) {
        selectedNode.title = itemName;
        $scope.getItem(selectedNode.lfData, 'question').value = selectedNode.title;
      }


      /**
       * Import button handler.
       *
       * Import data from lforms-service and adds it to the side bar tree
       *
       * @param scope - Scope from the template
       */
      $scope.importFromDialog = function (scope) {
        if (!$scope.dialogCancelled && scope.autocompSearch.model &&
            scope.autocompSearch.model.code) {
          gtag('event', 'import-loinc-item', {
            event_category: 'engagement',
            event_label: scope.importLoincItem.mode,
            value: scope.autocompSearch.model.code
          });
          var response = $scope.autocompSearch.model;
          if($scope.importLoincItem.mode === dataConstants.QUESTION) {
            var questionData = {
              questionCode: response.code,
              questionCodeSystem: dataConstants.LOINC,
              dataType: response.data.datatype === 'NM' ? 'REAL' : response.data.datatype,
              question: response.data.text,
              units: convertUnitsFromLoincToLforms(response.data.units),
              answers: convertAnswerListFromLoincToLforms(response.data.answers)
            };

            $scope.startSpin();
            $scope.insertNewItem(scope, formBuilderService.createFormBuilderQuestion(questionData), scope.insertType);
            setItemName($scope.selectedNode, questionData.question);
            $scope.previewWidget();
            $scope.stopSpin();
          }
          else if($scope.importLoincItem.mode === dataConstants.PANEL) {
            $scope.startSpin();
            var panelData =  $scope.autocompSearch.model;
            formBuilderService.getLoincPanelData(panelData.code, function(response, error) {
              if(error) {
                $scope._error = new Error(error);
                $scope.stopSpin();
                return;
              }
              formBuilderService.adjustFieldsToImportedLoinc(response);
              updateFormBuilder(scope, response);
              $scope.stopSpin();
            });
          }
          $scope.closeDialog();
        }
      };


      /**
       * Show add item dialog
       *
       * @param scope {Object} - Scope at the invocation of this method.
       * @param event {Object} - Event object invoking this method.
       * @param insertType {String} - An enumerated insertion type defined in
       * dataConstants.
       */
      $scope.showAddItemDialog = function (scope, event, insertType) {
        scope.dialogCancelled = false;
        scope.name = '';
        scope.autocompSearch.model = {text: '', code: '', value: ''};
        scope.insertType = insertType;

        $mdDialog.show({
          scope: scope,
          preserveScope: true,
          templateUrl: 'app/form-builder/add-item-dialog.html',
          parent: angular.element(document.body),
          targetEvent: event
        });
      };


      /**
       * Close button handler
       */
      $scope.closeDialog = function() {
        $mdDialog.hide();
      };


      /**
       * Cancel button handler
       */
      $scope.cancelDialog = function() {
        $scope.dialogCancelled = true;
        $scope.closeDialog();
      };


      /**
       * Change url of the lforms-service search box.
       *
       */
      $scope.changeAutoCompUrl = function() {
        angular.element(document.getElementById('searchQuestionId'))[0].autocomp.clearInvalidFieldVal();
        var url = $scope.autocompSearch.opts.url;
        if($scope.importLoincItem.mode === dataConstants.PANEL) {
          url = $scope.formsUrl;
        }
        else if($scope.importLoincItem.mode === dataConstants.QUESTION) {
          url = $scope.questionsUrl;
        }
        $scope.autocompSearch.opts.url = url;
      };


      /**
       * Get scope of rootNodes.
       * @returns {Object} Root scope of the tree
       */
      $scope.getRootNodesScope = function () {
        return angular.element(document.getElementById("question-root")).scope();
      };

      $scope.setFormBuilderData();
      $scope.updateLFData($scope.formBuilderData);

      /**
       * Intended to replace existing form with new form, typically from uploaded file.
       *
       * @param importedData - New form data
       */
      $scope.replaceForm = function(importedData) {
        if(importedData) {
          $scope.startSpin();
          deregisterDirtyCheckWatches($scope);
          $scope.updateLFData(formBuilderService.createFormBuilder(importedData));
          $scope.selectNode($scope.formBuilderData.treeData[0]);
          $scope.stopSpin();
        }
      };


      /**
       * Listen to replace form event, intended to capture the event from
       * menu import events from a file sytem, fhir server etc.
       *
       * @param lfData {object} - lforms data to load into the form builder.
       *
       */
      $scope.$on('REPLACE_FORM', function (ev, lfData) {
        $scope.replaceForm(lfData);
      });


      /**
       * Update form builder with imported panel data, typically from lforms-service.
       * @param scope - If clicked from tree node, it is node scope.
       *   In case of non-node scope, append the panel to tree root
       * @param importedData - Panel data
       */
      function updateFormBuilder(scope, importedData) {
        var nodes = formBuilderService.createPanelTree(importedData);
        var currentNode = $scope.selectedNode;
        // Based on the insertion option, figure out the nodesScope and index of the
        // insertion.
        var contextNodesScope = null;
        var insertIndex = (currentNode && currentNode.id) ?
                          parseInt(currentNode.id.substring(currentNode.id.lastIndexOf('.')+1)) : 0;

        switch (scope.insertType){
          case dataConstants.INSERT_AFTER:
            contextNodesScope = scope.$parentNodesScope;
            break;

          case dataConstants.INSERT_BEFORE:
            contextNodesScope = scope.$parentNodesScope;
            insertIndex--;
            break;

          case dataConstants.INSERT_AS_CHILD:
            contextNodesScope = scope.$childNodesScope;
            insertIndex = contextNodesScope.childNodes().length;
            break;

          case dataConstants.APPEND_TO_ROOT:
            contextNodesScope = scope.getRootNodesScope();
            insertIndex = contextNodesScope.childNodes().length;
            break;
        }
        if(!contextNodesScope) {
          // Tree is empty
          contextNodesScope = scope.getRootNodesScope();
          insertIndex = 0;
        }
        nodes.forEach(function(node) {
          contextNodesScope.insertNode(insertIndex, node);
          currentNode = node;
        });
        if(nodes.length > 0) {
          currentNode = nodes[0];
        }
        if(!$scope.selectedNode) {
          $scope.selectNode($scope.formBuilderData.treeData[0]);
        }
        else {
          $scope.selectNode(currentNode);
        }
      }


      /**
       * Convert answerlist field from loinc definition to lforms definition
       *
       * @param answerList - Array of loinc answers
       * @return Array of lforms answers.
       */
      function convertAnswerListFromLoincToLforms(answerList) {

        if(answerList) {
          answerList.forEach(function(answer) {
            answer.code = answer.AnswerStringID;
            answer.text = answer.DisplayText;
            answer.score = answer.Score;
            delete answer.AnswerStringID;
            delete answer.DisplayText;
            delete answer.Score;
          });
        }
        return answerList;
      }


      /**
       * Convert units field from loinc definition to lforms definition
       *
       * @param units - Array of loinc units
       * @return Array of lforms units
       */
      function convertUnitsFromLoincToLforms(units) {
        if(units) {
          units.forEach(function(unit) {
            unit.name = unit.unit;
            delete unit.unit;
          });
        }
        return units;
      }


      /**
       * Compare old and new value objects.
       *
       * @param oldValue {Object}
       * @param newValue {Object}
       * @returns {boolean}
       */
      function isDirty(oldValue, newValue) {
        return !angular.equals(oldValue, newValue);
      }


      /**
       * Setup angular watches on form builder inputs. The watch expressions are listed in a scope variable.
       * The watch registrations are stored in another scope variable for later use.
       *
       *  @param scope {Object} - Angular scope object
       */
      function setDirtyCheckWatches(scope) {
        // Set watches on newly selected node.

        Object.keys(scope.watchExpressions).forEach(function (expressionId) {
          var exp = scope.watchExpressions[expressionId];
          switch(expressionId) {

            // Watch question and questionCode to update item name (which goes as formbuilder panel title).
            case 'question':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  var code = scope.selectedNode.lfData.basic.itemHash['/questionCode/1'].value;
                  if(code && code.length > 0) {
                    code = ' [' + code + ']';
                  }
                  if (!code) {
                    code = '';
                  }
                  scope.selectedNode.lfData.basic.name = scope.selectedNode.id + ' ' + newValue + code;
                  scope.selectedNode.lfData.advanced.name = scope.selectedNode.lfData.basic.name;
                  if(newValue !== oldValue) {
                    scope.selectedNode.isDirty = true;
                  }
                }
              }, true);
              break;

            case 'questionCode':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  var code = '';
                  if(newValue && newValue.length > 0) {
                    code = ' [' + newValue + ']';
                  }
                  scope.selectedNode.lfData.basic.name = scope.selectedNode.id + ' ' +
                    scope.selectedNode.lfData.basic.itemHash['/question/1'].value + code;
                  scope.selectedNode.lfData.advanced.name = scope.selectedNode.lfData.basic.name;
                }
              }, true);
              break;

            // Watch questionCodeSystem to toggle read only attribute of questionCode. If LOINC set it to read only.
            case 'questionCodeSystem':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  if(isDirty(oldValue, newValue) ) {
                    if(newValue.code === dataConstants.CUSTOM) {
                      scope.selectedNode.lfData.basic.itemHash['/questionCode/1'].editable = '1';
                      scope.selectedNode.isDirty = true;
                    }
                    else if(newValue.code === dataConstants.LOINC) {
                      scope.selectedNode.lfData.basic.itemHash['/questionCode/1'].editable = '0';
                    }
                  }
                }
              }, true);
              break;

            // Watch header to toggle some advanced items.
            case 'header':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  scope.selectedNode.lfData.advanced.itemHash['/_isHeader/1'].value =
                    (newValue && newValue.text) ? newValue.text : 'No';

                  if (isDirty(oldValue, newValue)) {
                    var dataType = scope.selectedNode.lfData.basic.itemHash['/dataType/1'];
                    if (newValue.code) {
                      // User changed header to true, set the data type to section.
                      dataType.value = {code: 'SECTION'};
                    } else if(dataType.value && dataType.value.code === 'SECTION') {
                      // Header is set to false, if data is a section, change it to default.
                      dataType.value = {code: 'ST'};
                    }
                    scope.selectedNode.isDirty = true;
                  }
                }
              }, true);
              break;

            // Watch dataType for use in advanced panel.
            case 'dataType':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  // The data type is needed in advanced panel for skip logic of some items such as display control.
                  // To avoid complicated boolean logic on skip logic conditions with source items of type CNE/CWE,
                  // a made up string '__CNE_OR_CWE__' is created.
                  var val = null;
                  if(newValue && newValue.code) {
                    val = (newValue.code === 'CNE' || newValue.code === 'CWE') ? '__CNE_OR_CWE__' : newValue.code;
                  }

                  scope.selectedNode.lfData.advanced.itemHash['/_dataType/1'].value = val;

                  if(isDirty(oldValue, newValue)) {
                    scope.selectedNode.isDirty = true;
                  }
                }
              }, true);
              break;

            // Watch externallyDefined for use in listColHeaders of displayControl in advanced panel.
            case 'externallyDefined':
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  scope.selectedNode.lfData.advanced.itemHash['/_externallyDefined/1'].value =
                    !!(newValue && newValue.trim().length > 0);
                  if(isDirty(oldValue, newValue)) {
                    scope.selectedNode.isDirty = true;
                  }
                }
              }, true);
              break;

            // Setup watches for rest of the expression list.
            default:
              scope.watchDeregisters[exp] = scope.$watch(exp, function(newValue, oldValue) {
                if(scope.selectedNode) {
                  if(isDirty(oldValue, newValue)) {
                    if(!scope.loading) {
                      scope.selectedNode.isDirty = true;
                    }
                  }
                }
              }, true);
              break;
          }
        });
      }

      /**
       * De-register all existing watches
       *
       * @param scope {Object} - Angular scope object
       */
      function deregisterDirtyCheckWatches(scope) {
        Object.keys(scope.watchDeregisters).forEach(function (exp) {
          if(scope.watchDeregisters[exp]) {
            scope.watchDeregisters[exp]();
          }
        });
      }

    }]);
})();
