# Enable secondary expansion
.SECONDEXPANSION:

CURL ?= curl
FIND ?= find
TAR ?= tar

# Set shell to bash
SHELL := /bin/bash

# Use this variable to specify a different make utility (e.g. remake --profile)
MAKE ?= make

# Include this file first
_empty :=
_space := $(_empty) $(empty)
_comma := ,

# Main branch
MAIN_BRANCH ?= main

BRANCH_NAME ?= $(shell git rev-parse --abbrev-ref HEAD || true)
# Set RELEASE_BRANCH if we're on main or vN.N.x
RELEASE_BRANCH := $(shell echo $(BRANCH_NAME) | grep -E '^($(MAIN_BRANCH)|v[0-9]+\.[0-9]+\.x)$$')

MAKEFILE_NAME ?= Makefile
MAKE_ARGS := -f $(MAKEFILE_NAME)

GIT_REMOTE_NAME ?= origin
